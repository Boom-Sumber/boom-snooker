-- ============================================================
-- 028 · 审核通知 + 待审记录详情（T4.6 / T4.7）
--
-- 解决 T4 收尾时发现的两个问题：
--   ① 审核对话框里只有文字预览，看不到图 —— 而打法是否合格很大程度取决于图片
--      → `get_review_record()`：让详情页能按 id 取到**待审**记录（带图），
--        详情页在"快照里没有 + 我是管理员"时进入审核预览模式
--   ② 作者被审核后没有任何反馈（评论只有列表里的标签，记录干脆没有入口）
--      → `notifications` 表 + 审核触发器自动落一条，客户端「通知」页签展示
--
-- 关键约束（别破坏）
--   · 通知**不进快照**、不 bump `dataset_version`（铁律 6 的同类问题）
--   · 通知表只给本人读；写入只走触发器（security definer），客户端没有写策略
--   · 已读只能通过 RPC 改（表上没有 update 策略）
--
-- 回滚：见文末注释
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. 通知表
-- ─────────────────────────────────────────────
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  kind        text not null
              check (kind in ('comment_visible','comment_rejected','record_visible','record_rejected')),
  title       text not null,
  body        text,
  -- 点通知跳到哪：评论记「它挂在哪条记录上」，记录就是它自己
  target_type text not null check (target_type in ('ball','advanced')),
  target_id   uuid not null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notifications_user
  on notifications (user_id, created_at desc);

comment on table notifications is
  '审核结果通知（T4.7）：由审核触发器写入，不进快照；客户端只读自己的、只能通过 RPC 标已读';

alter table notifications enable row level security;

-- 只给"读自己"：没有 insert/update/delete 策略，写入只能来自 definer 触发器/RPC
drop policy if exists n_read on notifications;
create policy n_read on notifications for select to authenticated
  using (user_id = auth.uid());

-- ─────────────────────────────────────────────
-- 2. 评论审核 → 通知作者
-- ─────────────────────────────────────────────
create or replace function notify_comment_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- 只处理「pending → visible / rejected」这一次状态迁移
  if old.status = new.status then return new; end if;
  if old.status <> 'pending' then return new; end if;
  if new.user_id is null then return new; end if;

  insert into notifications (user_id, kind, title, body, target_type, target_id)
  values (
    new.user_id,
    case new.status when 'visible' then 'comment_visible' else 'comment_rejected' end,
    case new.status when 'visible' then '你的评论已通过审核' else '你的评论未通过审核' end,
    case
      when new.status = 'visible' then left(new.content, 60)
      else coalesce(nullif(btrim(coalesce(new.review_note, '')), ''), '管理员没有填写原因')
    end,
    new.target_type,
    new.target_id
  );
  return new;
end $$;

drop trigger if exists trg_notify_comment_review on comments;
create trigger trg_notify_comment_review after update on comments
for each row execute function notify_comment_review();

-- ─────────────────────────────────────────────
-- 3. 记录审核 → 通知作者
--    彩球 / 进阶共用，用 tg_table_name 区分
-- ─────────────────────────────────────────────
create or replace function notify_record_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_type  text := case tg_table_name when 'balls' then 'ball' else 'advanced' end;
  v_label text;
begin
  if old.review_status = new.review_status then return new; end if;
  if old.review_status <> 'pending' then return new; end if;
  if new.owner_id is null then return new; end if;

  v_label := case tg_table_name
               when 'balls' then coalesce(nullif(btrim(new.method), ''), '这条打法')
               else coalesce(nullif(btrim(new.title), ''), '这条进阶')
             end;

  insert into notifications (user_id, kind, title, body, target_type, target_id)
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
    new.id
  );
  return new;
end $$;

drop trigger if exists trg_notify_record_review on balls;
create trigger trg_notify_record_review after update on balls
for each row execute function notify_record_review();

drop trigger if exists trg_notify_record_review on advanced;
create trigger trg_notify_record_review after update on advanced
for each row execute function notify_record_review();

-- ─────────────────────────────────────────────
-- 4. 读接口：列表 / 未读数 / 标已读
-- ─────────────────────────────────────────────
create or replace function list_notifications(
  p_limit  int default 20,
  p_offset int default 0
)
returns table (
  id          uuid,
  kind        text,
  title       text,
  body        text,
  target_type text,
  target_id   uuid,
  read_at     timestamptz,
  created_at  timestamptz,
  total       bigint
)
language plpgsql security definer stable set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_limit is null or p_limit <= 0 then p_limit := 20; end if;
  if p_limit > 100 then p_limit := 100; end if;
  if p_offset is null or p_offset < 0 then p_offset := 0; end if;

  return query
  select n.id, n.kind, n.title, n.body, n.target_type, n.target_id,
         n.read_at, n.created_at, count(*) over ()
    from notifications n
   where n.user_id = v_uid
   order by n.created_at desc, n.id desc
   limit p_limit offset p_offset;
end $$;

create or replace function count_unread_notifications()
returns bigint
language sql security definer stable set search_path = public as $$
  select case
    when auth.uid() is null then 0::bigint
    else (select count(*) from notifications n
           where n.user_id = auth.uid() and n.read_at is null)
  end;
$$;

/** 标已读：不传 ids = 全部已读；传了只标这些 */
create or replace function mark_notifications_read(p_ids uuid[] default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  update notifications
     set read_at = now()
   where user_id = auth.uid()
     and read_at is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ─────────────────────────────────────────────
-- 5. 待审记录详情（给详情页做审核预览）
--
--    详情页平时读本地快照，待审记录不在里面 → 打不开。
--    这个函数按 id 取**单条待审记录**（整行，含图片路径），
--    范围校验与 `review_record` 完全一致。
-- ─────────────────────────────────────────────
create or replace function get_review_record(p_type text, p_id uuid)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_row   jsonb;
  v_owner uuid;
begin
  if not has_any_role(array['admin', 'superadmin']) then
    raise exception 'FORBIDDEN';
  end if;

  if p_type = 'ball' then
    select to_jsonb(b) into v_row from balls b
     where b.id = p_id and b.review_status = 'pending';
  elsif p_type = 'advanced' then
    select to_jsonb(a) into v_row from advanced a
     where a.id = p_id and a.review_status = 'pending';
  else
    raise exception 'BAD_TYPE';
  end if;

  if v_row is null then
    raise exception 'NOT_PENDING';
  end if;

  v_owner := (v_row ->> 'owner_id')::uuid;
  if v_owner is null then
    if not is_superadmin() then raise exception 'FORBIDDEN'; end if;
  elsif not can_review_owner(v_owner) then
    raise exception 'FORBIDDEN';
  end if;

  return v_row;
end $$;

comment on function get_review_record(text, uuid) is
  '按 id 取单条待审记录（含图片路径），供详情页的审核预览模式使用（T4.6）';

-- ─────────────────────────────────────────────
-- 6. 权限
-- ─────────────────────────────────────────────
revoke execute on function list_notifications(int, int)      from public, anon;
revoke execute on function count_unread_notifications()      from public, anon;
revoke execute on function mark_notifications_read(uuid[])   from public, anon;
revoke execute on function get_review_record(text, uuid)     from public, anon;

grant execute on function list_notifications(int, int)     to authenticated;
grant execute on function count_unread_notifications()     to authenticated;
grant execute on function mark_notifications_read(uuid[])  to authenticated;
grant execute on function get_review_record(text, uuid)    to authenticated;

-- 触发器函数不需要给任何人 EXECUTE（触发器执行不检查权限）
revoke execute on function notify_comment_review() from public, anon, authenticated;
revoke execute on function notify_record_review()  from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 回滚
--   drop trigger if exists trg_notify_comment_review on comments;
--   drop trigger if exists trg_notify_record_review on balls;
--   drop trigger if exists trg_notify_record_review on advanced;
--   drop function if exists get_review_record(text, uuid);
--   drop function if exists mark_notifications_read(uuid[]);
--   drop function if exists count_unread_notifications();
--   drop function if exists list_notifications(int, int);
--   drop table if exists notifications;
-- ─────────────────────────────────────────────
