-- ============================================================
-- 031 · 作者侧投稿可见性 / 审核回显 / 角色变更通知（T4.11 ~ T4.14）
--
-- 用户提的六条问题里，有五条要动后端：
--   ① 弹窗三栏要显示"总数"（不是未读数）            → notification_counts()
--   ② 作者要能看见自己的待审/驳回记录                → get_my_record() / list_my_records()
--   ③ 待审期间不允许改内容，驳回后可以改完重新提交     → upsert_* 加 PENDING_LOCKED
--   ④ 作者删记录时，相关审核通知要一起删掉            → clear_record_notifications 触发器
--   ⑤ 记录也要有审核回显（谁审的 + 角色 + 时间 + 结果）→ list_comments / get_my_record 回 reviewer_*
--   ⑥ 角色变更要通知本人                             → notify_role_changed 触发器
--
-- 设计取舍
--   · 作者自己的 pending/rejected 记录**不进快照**（快照是公开分发、会被本地缓存），
--     单独用 `get_my_record` 按 id 取 —— 切账号不会串数据，也不给匿名用户看到待审内容
--   · `kind='role_changed'` 归到「系统」类通知（它不是审核结果）
--
-- 回滚：见文末注释
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. 通知：新增 role_changed 类型
-- ─────────────────────────────────────────────
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('comment_visible', 'comment_rejected',
                  'record_visible',  'record_rejected',
                  'system', 'role_changed'));

-- ─────────────────────────────────────────────
-- 2. 角色变更 → 通知本人（T4.14）
--    改角色走 set_user_role RPC，更新 profiles.role 时触发
-- ─────────────────────────────────────────────
create or replace function notify_role_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_label text;
begin
  if old.role = new.role then return new; end if;

  v_label := case new.role
               when 'viewer'     then '普通用户'
               when 'advanced'   then '高级用户'
               when 'admin'      then '管理员'
               when 'superadmin' then '超级管理员'
               else new.role
             end;

  insert into notifications
    (user_id, kind, title, body, target_type, target_id, reviewer_id, reviewed_at)
  values (
    new.id,
    'role_changed',
    '你的账户角色已更新',
    '现在是「' || v_label || '」，请重启程序后生效',
    null, null, auth.uid(), now()
  );
  return new;
end $$;

drop trigger if exists trg_notify_role_changed on profiles;
create trigger trg_notify_role_changed after update of role on profiles
for each row execute function notify_role_changed();

-- ─────────────────────────────────────────────
-- 3. 通知计数：全部 / 系统类 / 未读（T4.11）
--    「系统类」= system + role_changed
-- ─────────────────────────────────────────────
create or replace function notification_counts()
returns jsonb
language sql security definer stable set search_path = public as $$
  select case
    when auth.uid() is null then jsonb_build_object('all', 0, 'system', 0, 'unread', 0)
    else (
      select jsonb_build_object(
        'all',    count(*),
        'system', count(*) filter (where kind in ('system', 'role_changed')),
        'unread', count(*) filter (where read_at is null)
      )
      from notifications where user_id = auth.uid()
    )
  end;
$$;

-- list_notifications 的 scope 语义同步调整（system 含 role_changed）
drop function if exists list_notifications(int, int, text);

create function list_notifications(
  p_limit  int default 20,
  p_offset int default 0,
  p_scope  text default 'all'
)
returns table (
  id            uuid,
  kind          text,
  title         text,
  body          text,
  target_type   text,
  target_id     uuid,
  reviewer_name text,
  reviewed_at   timestamptz,
  read_at       timestamptz,
  created_at    timestamptz,
  total         bigint
)
language plpgsql security definer stable set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_scope is null or p_scope not in ('all', 'review', 'system') then p_scope := 'all'; end if;
  if p_limit is null or p_limit <= 0 then p_limit := 20; end if;
  if p_limit > 100 then p_limit := 100; end if;
  if p_offset is null or p_offset < 0 then p_offset := 0; end if;

  return query
  select n.id, n.kind, n.title, n.body, n.target_type, n.target_id,
         rp.nickname, n.reviewed_at, n.read_at, n.created_at, count(*) over ()
    from notifications n
    left join profiles rp on rp.id = n.reviewer_id
   where n.user_id = v_uid
     and (
       p_scope = 'all'
       or (p_scope = 'system' and n.kind in ('system', 'role_changed'))
       or (p_scope = 'review' and n.kind not in ('system', 'role_changed'))
     )
   order by n.created_at desc, n.id desc
   limit p_limit offset p_offset;
end $$;

-- ─────────────────────────────────────────────
-- 4. 记录被删除时，清掉它的审核通知（T4.12）
--    软删除是 update state 0，用触发器覆盖"RPC 删"和"运维直接改"两种情况
-- ─────────────────────────────────────────────
create or replace function clear_record_notifications() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.state = 0 and old.state <> 0 then
    delete from notifications where target_id = new.id;
  end if;
  return null;
end $$;

drop trigger if exists trg_clear_ball_notifications on balls;
create trigger trg_clear_ball_notifications after update on balls
for each row execute function clear_record_notifications();

drop trigger if exists trg_clear_adv_notifications on advanced;
create trigger trg_clear_adv_notifications after update on advanced
for each row execute function clear_record_notifications();

-- ─────────────────────────────────────────────
-- 5. 待审期间锁定编辑（T4.12）
--    作者能改自己的驳回记录（改完自动回到 pending），但**不能改正在待审的**
--    （否则"审核中的内容"和"审完的内容"可能不是同一份）
-- ─────────────────────────────────────────────
create or replace function upsert_ball(p jsonb, expected_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur int; new_id uuid; existing_owner uuid; v_status text;
begin
  if not can_write_records() then raise exception 'FORBIDDEN'; end if;

  select version into cur from dataset_meta where id = 1;
  if expected_version is not null and cur <> expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  new_id := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());

  if nullif(p->>'id', '') is not null then
    select owner_id, review_status into existing_owner, v_status
      from balls where id = new_id;
    if existing_owner is distinct from auth.uid() then
      raise exception 'FORBIDDEN';
    end if;
    if v_status = 'pending' then
      raise exception 'PENDING_LOCKED';
    end if;
  end if;

  insert into balls (id, owner_id, color_code, pocket_code, method, strength_code, sight,
                     low_comp, high_comp, remark, impact_image, blue_image, route_image,
                     state, updated_at, updated_by)
  values (new_id, auth.uid(), p->>'color_code', p->>'pocket_code', p->>'method',
          p->>'strength_code', p->>'sight', p->>'low_comp', p->>'high_comp', p->>'remark',
          p->>'impact_image', p->>'blue_image', p->>'route_image',
          1, now(), (select nickname from profiles where id = auth.uid()))
  on conflict (id) do update set
    color_code    = excluded.color_code,
    pocket_code   = excluded.pocket_code,
    method        = excluded.method,
    strength_code = excluded.strength_code,
    sight         = excluded.sight,
    low_comp      = excluded.low_comp,
    high_comp     = excluded.high_comp,
    remark        = excluded.remark,
    impact_image  = excluded.impact_image,
    blue_image    = excluded.blue_image,
    route_image   = excluded.route_image,
    state         = 1,
    updated_at    = now(),
    updated_by    = excluded.updated_by;

  return jsonb_build_object('id', new_id,
                            'version', (select version from dataset_meta where id = 1));
end $$;

create or replace function upsert_advanced(p jsonb, expected_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur int; new_id uuid; existing_owner uuid; v_status text;
begin
  if not can_write_records() then raise exception 'FORBIDDEN'; end if;

  select version into cur from dataset_meta where id = 1;
  if expected_version is not null and cur <> expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  new_id := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());

  if nullif(p->>'id', '') is not null then
    select owner_id, review_status into existing_owner, v_status
      from advanced where id = new_id;
    if existing_owner is distinct from auth.uid() then
      raise exception 'FORBIDDEN';
    end if;
    if v_status = 'pending' then
      raise exception 'PENDING_LOCKED';
    end if;
  end if;

  insert into advanced (id, owner_id, category_code, title, description, content, image,
                        state, updated_at, updated_by)
  values (new_id, auth.uid(), p->>'category_code', p->>'title', p->>'description',
          p->>'content', p->>'image', 1, now(),
          (select nickname from profiles where id = auth.uid()))
  on conflict (id) do update set
    category_code = excluded.category_code,
    title         = excluded.title,
    description   = excluded.description,
    content       = excluded.content,
    image         = excluded.image,
    state         = 1,
    updated_at    = now(),
    updated_by    = excluded.updated_by;

  return jsonb_build_object('id', new_id,
                            'version', (select version from dataset_meta where id = 1));
end $$;

-- ─────────────────────────────────────────────
-- 6. 作者看自己的记录（T4.12 / T4.13）
--
--    待审/驳回的记录不在快照里，作者以前根本看不到自己刚发的东西。
--    这两个函数只认 owner = auth.uid()，并额外回审核人昵称与角色
--    （角色用来渲染「由 管理员 xxx 审核」）。
-- ─────────────────────────────────────────────
create or replace function get_my_record(p_type text, p_id uuid)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_row    jsonb;
  v_owner  uuid;
  v_review uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  if p_type = 'ball' then
    select to_jsonb(b), b.owner_id, b.reviewed_by into v_row, v_owner, v_review
      from balls b where b.id = p_id and b.state = 1;
  elsif p_type = 'advanced' then
    select to_jsonb(a), a.owner_id, a.reviewed_by into v_row, v_owner, v_review
      from advanced a where a.id = p_id and a.state = 1;
  else
    raise exception 'BAD_TYPE';
  end if;

  if v_row is null then raise exception 'NOT_FOUND'; end if;
  if v_owner is distinct from auth.uid() then raise exception 'FORBIDDEN'; end if;

  return v_row || jsonb_build_object(
    'reviewer_name', (select nickname from profiles where id = v_review),
    'reviewer_role', (select role     from profiles where id = v_review)
  );
end $$;

comment on function get_my_record(text, uuid) is
  '作者按 id 取自己的记录（含待审/驳回），额外回审核人昵称与角色（T4.12/T4.13）';

create or replace function list_my_records()
returns table (
  record_type   text,
  id            uuid,
  review_status text,
  review_note   text,
  reviewed_at   timestamptz,
  reviewer_name text,
  reviewer_role text,
  color_code    text,
  pocket_code   text,
  method        text,
  strength_code text,
  category_code text,
  title         text,
  updated_at    timestamptz
)
language sql security definer stable set search_path = public as $$
  select 'ball'::text, b.id, b.review_status, b.review_note, b.reviewed_at,
         rp.nickname, rp.role,
         b.color_code, b.pocket_code, b.method, b.strength_code,
         null::text, null::text, b.updated_at
    from balls b left join profiles rp on rp.id = b.reviewed_by
   where b.owner_id = auth.uid() and b.state = 1
  union all
  select 'advanced'::text, a.id, a.review_status, a.review_note, a.reviewed_at,
         rp.nickname, rp.role,
         null, null, null, null,
         a.category_code, a.title, a.updated_at
    from advanced a left join profiles rp on rp.id = a.reviewed_by
   where a.owner_id = auth.uid() and a.state = 1
   order by updated_at desc;
$$;

-- ─────────────────────────────────────────────
-- 7. 评论列表补 reviewer_role（T4.13）
-- ─────────────────────────────────────────────
drop function if exists list_comments(text, uuid, int, int);

create function list_comments(
  p_type      text,
  p_target_id uuid,
  p_limit     int default 20,
  p_offset    int default 0
)
returns table (
  id             uuid,
  content        text,
  status         text,
  created_at     timestamptz,
  user_id        uuid,
  nickname       text,
  avatar         text,
  gender         text,
  author_deleted boolean,
  review_note    text,
  reviewer_name  text,
  reviewer_role  text,
  reviewed_at    timestamptz,
  total          bigint
)
language plpgsql security definer stable set search_path = public as $$
declare
  v_uid uuid;
begin
  if p_type is null or p_type not in ('ball', 'advanced') then
    raise exception 'BAD_TYPE';
  end if;
  if p_target_id is null then
    raise exception 'BAD_TARGET';
  end if;
  if p_limit is null or p_limit <= 0 then p_limit := 20; end if;
  if p_limit > 100 then p_limit := 100; end if;
  if p_offset is null or p_offset < 0 then p_offset := 0; end if;

  select case
           when exists (
             select 1 from profiles p where p.id = auth.uid() and p.deleted_at is null
           ) then auth.uid()
           else null
         end
    into v_uid;

  return query
  select c.id, c.content, c.status, c.created_at, c.user_id,
         coalesce(p.nickname, '未知用户') as nickname,
         p.avatar,
         coalesce(p.gender, 'male') as gender,
         (p.deleted_at is not null) as author_deleted,
         case when v_uid is not null and c.user_id = v_uid then c.review_note   end as review_note,
         case when v_uid is not null and c.user_id = v_uid then rp.nickname     end as reviewer_name,
         case when v_uid is not null and c.user_id = v_uid then rp.role         end as reviewer_role,
         case when v_uid is not null and c.user_id = v_uid then c.reviewed_at   end as reviewed_at,
         count(*) over () as total
    from comments c
    left join profiles p  on p.id  = c.user_id
    left join profiles rp on rp.id = c.reviewed_by
   where c.target_type = p_type
     and c.target_id = p_target_id
     and c.deleted_at is null
     and (
       c.status = 'visible'
       or (v_uid is not null and (c.user_id = v_uid or can_review_owner(c.user_id)))
     )
   order by c.created_at desc, c.id desc
   limit p_limit offset p_offset;
end $$;

-- ─────────────────────────────────────────────
-- 8. 权限
-- ─────────────────────────────────────────────
revoke execute on function notification_counts()          from public, anon;
grant  execute on function notification_counts()          to authenticated;

revoke execute on function get_my_record(text, uuid)      from public, anon;
grant  execute on function get_my_record(text, uuid)      to authenticated;

revoke execute on function list_my_records()              from public, anon;
grant  execute on function list_my_records()              to authenticated;

revoke execute on function list_notifications(int, int, text) from public, anon;
grant  execute on function list_notifications(int, int, text) to authenticated;

revoke execute on function list_comments(text, uuid, int, int) from public;
grant  execute on function list_comments(text, uuid, int, int) to anon, authenticated;

revoke execute on function notify_role_changed()        from public, anon, authenticated;
revoke execute on function clear_record_notifications() from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 回滚
--   drop trigger if exists trg_notify_role_changed on profiles;
--   drop trigger if exists trg_clear_ball_notifications on balls;
--   drop trigger if exists trg_clear_adv_notifications on advanced;
--   drop function if exists notification_counts();
--   drop function if exists get_my_record(text, uuid);
--   drop function if exists list_my_records();
--   -- list_notifications / list_comments / upsert_* 用 030 / 016 的版本重建
-- ─────────────────────────────────────────────
