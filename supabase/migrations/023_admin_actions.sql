-- ============================================================
-- 023 · 审计日志（admin_actions）
--
-- 为什么用触发器而不是在每个 RPC 里手写 insert：
--   ① 七个写操作（停用/恢复/改角色/审记录/审评论/重置码/转移邀请）
--      都散在不同函数里，手写要改七遍，以后新增入口还会漏
--   ② 触发器能覆盖"运维直接在 SQL 里改"的情况 —— 出问题时最需要查的就是这种
--   ③ 审计记录的是**结果**（old → new），不是调用意图，天然不会骗人
--
-- actor 取 auth.uid()：security definer 函数里它仍是调用者的 JWT，
-- 所以 RPC 调用能被正确归因；运维在 SQL Editor 里改时 actor 为 null（也算如实记录）。
--
-- 回滚：drop trigger / drop function / drop table admin_actions
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. 表
-- ─────────────────────────────────────────────
create table if not exists admin_actions (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references profiles(id) on delete set null,
  action     text not null,          -- soft_delete_user / restore_user / set_user_role
                                     -- / review_record / review_comment
                                     -- / reset_invite_code / transfer_invitees
  target_id  uuid,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_actions_created on admin_actions (created_at desc);
create index if not exists idx_admin_actions_actor   on admin_actions (actor_id, created_at desc);
create index if not exists idx_admin_actions_target  on admin_actions (target_id, created_at desc);

alter table admin_actions enable row level security;

-- 只给超管读；**不给 insert/update/delete 策略** —— 只能由 security definer 触发器写入
drop policy if exists aa_read on admin_actions;
create policy aa_read on admin_actions for select to authenticated using (is_superadmin());

comment on table admin_actions is
  'D28/D29 审计：谁停用了谁、谁审了什么。只可读（超管），不可改。';

-- ─────────────────────────────────────────────
-- 2. 写入口（内部函数，不对外 grant）
-- ─────────────────────────────────────────────
create or replace function log_admin_action(p_action text, p_target uuid, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into admin_actions (actor_id, action, target_id, detail)
  values (auth.uid(), p_action, p_target, coalesce(p_detail, '{}'::jsonb));
end $$;

revoke execute on function log_admin_action(text, uuid, jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 3. 触发器
-- ─────────────────────────────────────────────

-- 3.1 停用 / 恢复
create or replace function audit_profile_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_admin_action(
    case when new.deleted_at is null then 'restore_user' else 'soft_delete_user' end,
    new.id,
    jsonb_build_object(
      'reason',   new.deleted_reason,
      'deleted_by', new.deleted_by
    )
  );
  return null;
end $$;

drop trigger if exists trg_audit_profile_deleted on profiles;
create trigger trg_audit_profile_deleted after update on profiles
for each row when (old.deleted_at is distinct from new.deleted_at)
execute function audit_profile_deleted();

-- 3.2 改角色
create or replace function audit_profile_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_admin_action(
    'set_user_role', new.id,
    jsonb_build_object('from', old.role, 'to', new.role)
  );
  return null;
end $$;

drop trigger if exists trg_audit_profile_role on profiles;
create trigger trg_audit_profile_role after update on profiles
for each row when (old.role is distinct from new.role)
execute function audit_profile_role();

-- 3.3 转移邀请关系
create or replace function audit_profile_inviter() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_admin_action(
    'transfer_invitees', new.id,
    jsonb_build_object('from', old.invited_by, 'to', new.invited_by)
  );
  return null;
end $$;

drop trigger if exists trg_audit_profile_inviter on profiles;
create trigger trg_audit_profile_inviter after update on profiles
for each row when (old.invited_by is distinct from new.invited_by)
execute function audit_profile_inviter();

-- 3.4 审核记录（balls / advanced 同构）
create or replace function audit_record_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_admin_action(
    'review_record', new.id,
    jsonb_build_object(
      'type', tg_table_name,
      'from', old.review_status,
      'to',   new.review_status,
      'note', new.review_note
    )
  );
  return null;
end $$;

drop trigger if exists trg_audit_balls_review on balls;
create trigger trg_audit_balls_review after update on balls
for each row when (old.review_status is distinct from new.review_status)
execute function audit_record_review();

drop trigger if exists trg_audit_adv_review on advanced;
create trigger trg_audit_adv_review after update on advanced
for each row when (old.review_status is distinct from new.review_status)
execute function audit_record_review();

-- 3.5 审核评论
create or replace function audit_comment_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_admin_action(
    'review_comment', new.id,
    jsonb_build_object('from', old.status, 'to', new.status, 'note', new.review_note)
  );
  return null;
end $$;

drop trigger if exists trg_audit_comment_review on comments;
create trigger trg_audit_comment_review after update on comments
for each row when (old.status is distinct from new.status)
execute function audit_comment_review();

-- 3.6 重置邀请码（旧码被 disable 的那一刻）
create or replace function audit_invite_reset() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform log_admin_action(
    'reset_invite_code', new.inviter_id,
    jsonb_build_object('old_code', new.code)
  );
  return null;
end $$;

drop trigger if exists trg_audit_invite_reset on invite_codes;
create trigger trg_audit_invite_reset after update on invite_codes
for each row when (old.disabled_at is null and new.disabled_at is not null)
execute function audit_invite_reset();
