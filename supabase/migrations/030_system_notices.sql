-- ============================================================
-- 030 · 系统通知 + 审核人信息（T4.8 / T4.9 / T4.10）
--
-- 三件事
--   ① 系统通知：超管发一条，所有在用账号都收到（走同一张 notifications 表，
--      已读/角标/列表逻辑全部复用）。kind = 'system'，不指向任何记录。
--   ② 通知可管理：删除单条 / 清空已读（自己只能动自己的）。
--   ③ 审核人信息：通知与「自己的评论」上带**谁审的 + 什么时候审的**。
--      只对作者可见 —— 别人看评论列表时这两个字段是 null。
--
-- 为什么系统通知用 fan-out（发布时给每个账号插一条）而不是"广播表 + 已读表"
--   · 用户上限 100，一次发布最多 100 行，代价可忽略
--   · 已读、角标、列表、删除全部沿用现成逻辑，不用第二套模型
--   · 代价：新注册的用户看不到历史系统通知（内部圈子可接受，先不做补发）
--
-- 回滚：见文末注释
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. 表结构调整
-- ─────────────────────────────────────────────
-- 系统通知不指向记录，target 允许为空
alter table notifications alter column target_type drop not null;
alter table notifications alter column target_id   drop not null;

alter table notifications drop constraint if exists notifications_target_type_check;
alter table notifications add constraint notifications_target_type_check
  check (target_type is null or target_type in ('ball', 'advanced'));

alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('comment_visible', 'comment_rejected',
                  'record_visible',  'record_rejected', 'system'));

-- 审核人 + 审核时间（只有通知所有者能读，见 §4 的 RPC）
alter table notifications
  add column if not exists reviewer_id uuid references profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

comment on column notifications.reviewer_id is
  '审核人（系统通知是发布人）。只通过 RPC 回给通知所有者，不随表暴露';

-- ─────────────────────────────────────────────
-- 2. 触发器补审核人信息（028 建的两个触发器函数）
-- ─────────────────────────────────────────────
create or replace function notify_comment_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = new.status then return new; end if;
  if old.status <> 'pending' then return new; end if;
  if new.user_id is null then return new; end if;

  insert into notifications
    (user_id, kind, title, body, target_type, target_id, reviewer_id, reviewed_at)
  values (
    new.user_id,
    case new.status when 'visible' then 'comment_visible' else 'comment_rejected' end,
    case new.status when 'visible' then '你的评论已通过审核' else '你的评论未通过审核' end,
    case
      when new.status = 'visible' then left(new.content, 60)
      else coalesce(nullif(btrim(coalesce(new.review_note, '')), ''), '管理员没有填写原因')
    end,
    new.target_type,
    new.target_id,
    new.reviewed_by,
    coalesce(new.reviewed_at, now())
  );
  return new;
end $$;

create or replace function notify_record_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_type  text;
  v_label text;
begin
  if old.review_status = new.review_status then return new; end if;
  if old.review_status <> 'pending' then return new; end if;
  if new.owner_id is null then return new; end if;

  -- 跨表取字段必须用 IF 分支（CASE 会把两个分支的字段都解析，见 029）
  if tg_table_name = 'balls' then
    v_type  := 'ball';
    v_label := coalesce(nullif(btrim(new.method), ''), '这条打法');
  else
    v_type  := 'advanced';
    v_label := coalesce(nullif(btrim(new.title), ''), '这条进阶');
  end if;

  insert into notifications
    (user_id, kind, title, body, target_type, target_id, reviewer_id, reviewed_at)
  values (
    new.owner_id,
    case new.review_status when 'visible' then 'record_visible' else 'record_rejected' end,
    case new.review_status
      when 'visible' then '你投稿的记录已通过审核'
      else '你投稿的记录未通过审核'
    end,
    case
      when new.review_status = 'visible' then v_label
      else coalesce(nullif(btrim(coalesce(new.review_note, '')), ''), '管理员没有填写原因')
    end,
    v_type,
    new.id,
    new.reviewed_by,
    coalesce(new.reviewed_at, now())
  );
  return new;
end $$;

-- ─────────────────────────────────────────────
-- 3. 系统通知：超管发布（fan-out 给所有在用账号）
-- ─────────────────────────────────────────────
create or replace function publish_system_notice(p_title text, p_body text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := nullif(btrim(coalesce(p_body, '')), '');
  v_n     int  := 0;
begin
  if not is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;
  if v_title = '' then
    raise exception 'EMPTY_TITLE';
  end if;
  if char_length(v_title) > 60 then
    raise exception 'TITLE_TOO_LONG';
  end if;
  if v_body is not null and char_length(v_body) > 500 then
    raise exception 'BODY_TOO_LONG';
  end if;

  insert into notifications
    (user_id, kind, title, body, target_type, target_id, reviewer_id, reviewed_at)
  select p.id, 'system', v_title, v_body, null, null, auth.uid(), now()
    from profiles p
   where p.deleted_at is null;
  get diagnostics v_n = row_count;

  insert into admin_actions (actor_id, action, detail)
  values (auth.uid(), 'publish_system_notice',
          jsonb_build_object('title', v_title, 'recipients', v_n));

  return v_n;
end $$;

comment on function publish_system_notice(text, text) is
  '超管发布系统通知（T4.8）：给所有未停用账号各插一条 kind=system 的通知';

-- ─────────────────────────────────────────────
-- 4. 读接口：列表（带审核人 + 按类型过滤）/ 删除
--
--    返回列变了（加 reviewer_name / reviewed_at、加 p_scope 参数），必须 drop 重建
-- ─────────────────────────────────────────────
drop function if exists list_notifications(int, int);

create function list_notifications(
  p_limit  int default 20,
  p_offset int default 0,
  p_scope  text default 'all'      -- all / review / system
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
         rp.nickname,
         n.reviewed_at,
         n.read_at, n.created_at,
         count(*) over ()
    from notifications n
    left join profiles rp on rp.id = n.reviewer_id
   where n.user_id = v_uid
     and (
       p_scope = 'all'
       or (p_scope = 'system' and n.kind = 'system')
       or (p_scope = 'review' and n.kind <> 'system')
     )
   order by n.created_at desc, n.id desc
   limit p_limit offset p_offset;
end $$;

/** 删一条自己的通知（系统通知也能删，删的是自己那份副本） */
create or replace function delete_notification(p_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  delete from notifications where id = p_id and user_id = auth.uid();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

/** 清空自己的已读通知 */
create or replace function clear_read_notifications()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  delete from notifications where user_id = auth.uid() and read_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ─────────────────────────────────────────────
-- 5. 评论列表：带审核人（只回给自己的评论）
--
--    返回列变了，drop 重建
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

  -- 已停用账号当 anon（D30）
  select case
           when exists (
             select 1 from profiles p
              where p.id = auth.uid() and p.deleted_at is null
           ) then auth.uid()
           else null
         end
    into v_uid;

  return query
  select c.id,
         c.content,
         c.status,
         c.created_at,
         c.user_id,
         coalesce(p.nickname, '未知用户')          as nickname,
         p.avatar,
         coalesce(p.gender, 'male')                as gender,
         (p.deleted_at is not null)                as author_deleted,
         -- 驳回原因与审核人**只给自己的评论**看
         case when v_uid is not null and c.user_id = v_uid then c.review_note end as review_note,
         case when v_uid is not null and c.user_id = v_uid then rp.nickname end      as reviewer_name,
         case when v_uid is not null and c.user_id = v_uid then c.reviewed_at end     as reviewed_at,
         count(*) over ()                          as total
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

comment on function list_comments(text, uuid, int, int) is
  '评论分页列表（T4.1/T4.10）：匿名只见 visible；自己的看三态 + 驳回原因 + 审核人';

-- ─────────────────────────────────────────────
-- 6. 权限
-- ─────────────────────────────────────────────
revoke execute on function list_notifications(int, int, text) from public, anon;
grant  execute on function list_notifications(int, int, text) to authenticated;

revoke execute on function delete_notification(uuid)        from public, anon;
grant  execute on function delete_notification(uuid)        to authenticated;

revoke execute on function clear_read_notifications()       from public, anon;
grant  execute on function clear_read_notifications()       to authenticated;

revoke execute on function publish_system_notice(text, text) from public, anon;
grant  execute on function publish_system_notice(text, text) to authenticated;

revoke execute on function list_comments(text, uuid, int, int) from public;
grant  execute on function list_comments(text, uuid, int, int) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 回滚
--   drop function if exists publish_system_notice(text, text);
--   drop function if exists delete_notification(uuid);
--   drop function if exists clear_read_notifications();
--   -- list_notifications / list_comments 用 028 / 025 的版本重建
--   alter table notifications drop column if exists reviewer_id, drop column if exists reviewed_at;
-- ─────────────────────────────────────────────
