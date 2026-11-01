-- ============================================================
-- 021 · 审核范围 + 快照作者状态（D28 / D30）
--
-- 目标：把"能管谁"从"角色"扩展到"邀请归属"。
--   · 管理员只能看/审/管自己邀请的账户及其内容
--   · 超管看全量，但只审自己**直邀**的内容（最小例外）
--   · 被停用账号在权限层当 anon（否则"停用"只是客户端登出，直接调 API 照样能写）
--   · 快照每行多返回 author_deleted，供前端画「已停用」标识
--
-- 为什么 deleted_* / hidden_reason 放这里而不是 022：
--   list_users() 要返回停用字段与"连带隐藏了几条"（T3.8 的「已停用」栏），
--   has_any_role() 要按 deleted_at 把账号当 anon —— 三处都依赖这些列。
--   022 只做「停用动作」（soft_delete / restore / transfer + 显式 bump）。
--
-- 回滚：见文末注释
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. profiles 停用字段（D25 原计划的 deleted_*）
-- ─────────────────────────────────────────────
alter table profiles
  add column if not exists deleted_at     timestamptz,
  add column if not exists deleted_by     uuid references profiles(id) on delete set null,
  add column if not exists deleted_reason text;

create index if not exists idx_profiles_deleted
  on profiles (deleted_at) where deleted_at is not null;

comment on column profiles.deleted_at is
  'D25/D29 软删除时间。非空 = 已停用：权限层当 anon，客户端拿到后立即登出';

-- 级联隐藏的标记（022 的 soft_delete_user 会写它；list_users 的 hidden_count 读它）
-- 为什么必须有：恢复账号时只能捞"随账号隐藏"的行，
-- 若按"隐藏过就恢复"去捞，会把**审核驳回**的内容一起放出来
alter table balls    add column if not exists hidden_reason text;
alter table advanced add column if not exists hidden_reason text;
alter table comments add column if not exists hidden_reason text;

comment on column balls.hidden_reason is
  'null = 正常；owner_deleted = 随作者停用而隐藏（可随账号恢复）';

-- ─────────────────────────────────────────────
-- 2. 权限函数：已停用账号一律当 anon
-- ─────────────────────────────────────────────
create or replace function current_role_code() returns text
language sql security definer stable set search_path = public as $$
  select coalesce(
    (select role from profiles where id = auth.uid() and deleted_at is null), 'anon');
$$;

create or replace function has_any_role(roles text[]) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce(
    (select role = any(roles) from profiles where id = auth.uid() and deleted_at is null), false);
$$;

-- ─────────────────────────────────────────────
-- 3. 归属判定
--    can_review_owner：能不能审这个人写的东西
--    can_manage_user ：能不能对这个人做用户管理（改角色 / 停用 / 恢复）
-- ─────────────────────────────────────────────
create or replace function can_review_owner(p_owner uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select case
    when p_owner is null          then false
    when p_owner = auth.uid()     then true          -- 自己的记录（管理员免审 / 本人可见）
    when is_superadmin()          then exists (      -- 超管：只审"直邀"（含历史账号 invited_by is null）
      select 1 from profiles where id = p_owner and invited_by is null)
    when has_any_role(array['admin']) then exists (  -- 管理员：只审自己邀请的
      select 1 from profiles where id = p_owner and invited_by = auth.uid())
    else false
  end;
$$;

create or replace function can_manage_user(p_target uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select case
    when p_target is null or p_target = auth.uid() then false   -- 不能管自己
    when is_superadmin() then exists (
      select 1 from profiles where id = p_target and role <> 'superadmin')
    when has_any_role(array['admin']) then exists (
      select 1 from profiles
       where id = p_target and invited_by = auth.uid()
         and role in ('viewer','advanced'))
    else false
  end;
$$;

-- ─────────────────────────────────────────────
-- 4. RLS：pending / rejected 只对"有审核权的人"可见
-- ─────────────────────────────────────────────
drop policy if exists balls_read on balls;
create policy balls_read on balls for select to anon, authenticated using (
  (state = 1 and review_status = 'visible')
  or (auth.uid() is not null and (
        owner_id = auth.uid()
        or can_review_owner(owner_id)
      ))
);

drop policy if exists adv_read on advanced;
create policy adv_read on advanced for select to anon, authenticated using (
  (state = 1 and review_status = 'visible')
  or (auth.uid() is not null and (
        owner_id = auth.uid()
        or can_review_owner(owner_id)
      ))
);

drop policy if exists c_read on comments;
create policy c_read on comments for select to anon, authenticated using (
  deleted_at is null and (
    status = 'visible'
    or (auth.uid() is not null and (
          user_id = auth.uid()
          or can_review_owner(user_id)
        ))
  )
);

-- profiles：从"全员可读"收紧到"自己 + 自己邀请的 + 超管"
--   作者昵称不再靠直读 profiles：记录用 balls.updated_by（文本），评论走 RPC join
drop policy if exists p_read on profiles;
create policy p_read on profiles for select to authenticated using (
  id = auth.uid()
  or invited_by = auth.uid()
  or is_superadmin()
);

-- ─────────────────────────────────────────────
-- 5. RPC：审核 / 用户列表 / 改角色 / 快照
-- ─────────────────────────────────────────────

-- 5.1 审核记录：外层仍是 admin+，内层按归属
create or replace function review_record(p_type text, p_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not has_any_role(array['admin','superadmin']) then raise exception 'FORBIDDEN'; end if;
  if p_decision not in ('visible', 'rejected') then raise exception 'BAD_DECISION'; end if;

  if p_type = 'ball' then
    select owner_id into v_owner from balls where id = p_id and review_status = 'pending';
  elsif p_type = 'advanced' then
    select owner_id into v_owner from advanced where id = p_id and review_status = 'pending';
  else
    raise exception 'BAD_TYPE';
  end if;

  if not found then raise exception 'NOT_PENDING'; end if;

  -- 历史数据可能 owner_id 为空：这种行只有超管能审
  if v_owner is null then
    if not is_superadmin() then raise exception 'FORBIDDEN'; end if;
  elsif not can_review_owner(v_owner) then
    raise exception 'FORBIDDEN';
  end if;

  if p_type = 'ball' then
    update balls
       set review_status = p_decision, reviewed_by = auth.uid(),
           reviewed_at = now(), review_note = p_note
     where id = p_id and review_status = 'pending';
  else
    update advanced
       set review_status = p_decision, reviewed_by = auth.uid(),
           reviewed_at = now(), review_note = p_note
     where id = p_id and review_status = 'pending';
  end if;
end $$;

-- 5.2 审核评论
create or replace function review_comment(p_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not has_any_role(array['admin','superadmin']) then raise exception 'FORBIDDEN'; end if;
  if p_decision not in ('visible', 'rejected') then raise exception 'BAD_DECISION'; end if;

  select user_id into v_owner from comments where id = p_id and status = 'pending';
  if not found then raise exception 'NOT_PENDING'; end if;
  if not can_review_owner(v_owner) then raise exception 'FORBIDDEN'; end if;

  update comments
     set status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = p_id and status = 'pending';
end $$;

-- 5.3 用户列表：返回类型变了，必须先 drop
drop function if exists list_users();

create function list_users()
returns table(
  id              uuid,
  nickname        text,
  email           text,
  role            text,
  gender          text,
  invited_by      uuid,
  inviter_nickname text,
  invited_at      timestamptz,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  deleted_at      timestamptz,
  deleted_by      uuid,
  deleter_nickname text,
  deleted_reason  text,
  hidden_count    bigint
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not has_any_role(array['admin','superadmin']) then raise exception 'FORBIDDEN'; end if;

  return query
    select p.id,
           p.nickname,
           u.email::text,
           p.role,
           p.gender,
           p.invited_by,
           inviter.nickname,
           p.invited_at,
           p.created_at,
           u.last_sign_in_at,
           p.deleted_at,
           p.deleted_by,
           deleter.nickname,
           p.deleted_reason,
           (select count(*) from balls b
             where b.owner_id = p.id and b.state = 0 and b.hidden_reason = 'owner_deleted')
         + (select count(*) from advanced a
             where a.owner_id = p.id and a.state = 0 and a.hidden_reason = 'owner_deleted')
      from profiles p
      join auth.users u        on u.id = p.id
      left join profiles inviter on inviter.id = p.invited_by
      left join profiles deleter on deleter.id = p.deleted_by
     where is_superadmin()                       -- 超管：全量
        or p.invited_by = auth.uid()             -- 管理员：只看自己邀请的
     order by p.deleted_at nulls first, p.created_at;
end $$;

revoke execute on function list_users() from public, anon;
grant  execute on function list_users() to authenticated;

-- 5.4 改角色：矩阵不变，追加归属范围；提升为 admin 时断开邀请关系
create or replace function set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  target_role text;
begin
  if not has_any_role(array['admin','superadmin']) then raise exception 'FORBIDDEN'; end if;
  if p_user_id = auth.uid() then raise exception 'FORBIDDEN'; end if;
  if p_role not in ('viewer', 'advanced', 'admin') then raise exception 'BAD_ROLE'; end if;

  select role into target_role from profiles where id = p_user_id;
  if target_role is null then raise exception 'USER_NOT_FOUND'; end if;
  if target_role = 'superadmin' then raise exception 'FORBIDDEN'; end if;

  -- 归属范围（D28）：admin 只能动自己邀请的 viewer/advanced
  if not can_manage_user(p_user_id) then raise exception 'FORBIDDEN'; end if;

  -- 角色矩阵（D26）
  if not is_superadmin() then
    if p_role = 'admin' or target_role = 'admin' then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  update profiles set role = p_role where id = p_user_id;

  -- 提升为管理员后断开邀请关系，否则会出现"管理员管管理员"（D28）
  if p_role = 'admin' then
    update profiles set invited_by = null where id = p_user_id;
  end if;
end $$;

-- 5.5 快照：每行加 author_deleted
create or replace function get_dataset_snapshot() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version',  (select version from dataset_meta where id = 1),
    'balls',    coalesce((
      select jsonb_agg(
               to_jsonb(b) || jsonb_build_object('author_deleted', exists(
                 select 1 from profiles p where p.id = b.owner_id and p.deleted_at is not null
               )) order by b.updated_at)
        from balls b
       where b.state = 1 and b.review_status = 'visible'), '[]'::jsonb),
    'advanced', coalesce((
      select jsonb_agg(
               to_jsonb(a) || jsonb_build_object('author_deleted', exists(
                 select 1 from profiles p where p.id = a.owner_id and p.deleted_at is not null
               )) order by a.updated_at)
        from advanced a
       where a.state = 1 and a.review_status = 'visible'), '[]'::jsonb),
    'dict',     coalesce((select jsonb_agg(to_jsonb(d) order by d.kind, d.sort)
                            from display_dict d), '[]'::jsonb)
  );
$$;

-- ─────────────────────────────────────────────
-- 6. 清掉 020 留下的 advisors 告警
--    gen_invite_code 不碰任何表，mutable search_path 无害，但告警看着烦
-- ─────────────────────────────────────────────
alter function public.gen_invite_code() set search_path = public;

-- ─────────────────────────────────────────────
-- 回滚（按顺序执行）：
--   drop function if exists list_users();
--   -- 从 016_rpc_roles.sql 恢复 review_record / review_comment / set_user_role
--   -- 从 013_permissions.sql 恢复 current_role_code / has_any_role
--   -- 从 004_rpc.sql 恢复 get_dataset_snapshot
--   drop policy if exists balls_read on balls;
--   drop policy if exists adv_read on advanced;
--   drop policy if exists c_read on comments;
--   drop policy if exists p_read on profiles;
--   -- 再按 013/017 原样重建四条读策略
--   drop function if exists can_review_owner(uuid);
--   drop function if exists can_manage_user(uuid);
--   alter table profiles drop column if exists deleted_at, drop column if exists deleted_by,
--                        drop column if exists deleted_reason;
-- ─────────────────────────────────────────────
