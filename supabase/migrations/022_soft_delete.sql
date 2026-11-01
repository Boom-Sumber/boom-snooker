-- ============================================================
-- 022 · 软删除 / 恢复 / 转移邀请关系（D25 / D29）
--
-- 语义（先看这段再读 SQL）：
--   · 停用 = 只置 profiles.deleted_at，**不删 auth.users**（邮箱仍占用、历史记录保留）
--   · 级联 = **只隐藏不物理删**：记录 state=0、评论 deleted_at=now()，都打 hidden_reason='owner_deleted'
--   · 恢复 = 只恢复 hidden_reason='owner_deleted' 的行，**审核驳回的内容不碰**
--   · 停用/恢复都必须**显式 bump dataset_version** —— profiles 变更不触发 bump_dataset_version，
--     不 bump 的话客户端快照里 author_deleted 永远是 false，「已停用」标识不出现（D30）
--
-- 为什么级联隐藏不能动 review_status：
--   若把 pending/visible 都改成 rejected，恢复时按"隐藏过就恢复"去捞，
--   会把**审核驳回**的内容一起放出来。所以用独立的 hidden_reason 打标记，
--   review_status 保持原值，恢复后自然回到原来的审核状态。
--
-- 回滚：drop function soft_delete_user / restore_user / transfer_invitees
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. 停用账户
-- ─────────────────────────────────────────────
create or replace function soft_delete_user(
  p_target  uuid,
  p_cascade boolean default false,
  p_reason  text    default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role      text;
  v_deleted   timestamptz;
  v_pending   int;
  v_hidden    int := 0;
  v_comments  int := 0;
  v_super     uuid;
  v_reparent  int := 0;
  v_n         int := 0;
begin
  if not has_any_role(array['admin','superadmin']) then
    raise exception 'FORBIDDEN';
  end if;
  if p_target is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  select role, deleted_at into v_role, v_deleted from profiles where id = p_target;
  if v_role is null then
    raise exception 'USER_NOT_FOUND';
  end if;
  if v_deleted is not null then
    raise exception 'ALREADY_DELETED';
  end if;

  -- 归属范围：admin 只能停用自己邀请的 viewer/advanced；不能动自己 / 超管 / 其他管理员
  if not can_manage_user(p_target) then
    raise exception 'FORBIDDEN';
  end if;

  -- 不级联时，若还有待审内容，让前端先提示一次（前端捕获 PENDING_EXISTS 再决定）
  select (select count(*) from balls    where owner_id = p_target and review_status = 'pending' and state = 1)
       + (select count(*) from advanced where owner_id = p_target and review_status = 'pending' and state = 1)
    into v_pending;

  if v_pending > 0 and not p_cascade then
    raise exception 'PENDING_EXISTS:%', v_pending;
  end if;

  -- ① 停用
  update profiles
     set deleted_at     = now(),
         deleted_by     = auth.uid(),
         deleted_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_target;

  -- ② 级联隐藏（只隐藏，不物理删）
  if p_cascade then
    update balls
       set state = 0, hidden_reason = 'owner_deleted'
     where owner_id = p_target and state = 1;
    get diagnostics v_hidden = row_count;

    update advanced
       set state = 0, hidden_reason = 'owner_deleted'
     where owner_id = p_target and state = 1;
    get diagnostics v_n = row_count;
    v_hidden := v_hidden + v_n;

    update comments
       set deleted_at = now(), hidden_reason = 'owner_deleted'
     where user_id = p_target and deleted_at is null;
    get diagnostics v_comments = row_count;
  end if;

  -- ③ 目标是管理员时，其邀请账户转挂超管（否则这些账户无人可管，D28/K3）
  if v_role in ('admin','superadmin') then
    select id into v_super
      from profiles
     where role = 'superadmin' and deleted_at is null and id <> p_target
     limit 1;

    if v_super is not null then
      update profiles set invited_by = v_super
       where invited_by = p_target;
      get diagnostics v_reparent = row_count;
    end if;
  end if;

  -- ④ 必须显式 bump：profiles 变更不会触发 bump_dataset_version（D30）
  update dataset_meta set version = version + 1, updated_at = now() where id = 1;

  return jsonb_build_object(
    'ok', true,
    'hidden_records', v_hidden,
    'hidden_comments', v_comments,
    'reparented', v_reparent
  );
end $$;

-- ─────────────────────────────────────────────
-- 2. 恢复账户
-- ─────────────────────────────────────────────
create or replace function restore_user(
  p_target          uuid,
  p_restore_content boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_deleted    timestamptz;
  v_inviter    uuid;
  v_inviter_ok boolean;
  v_super      uuid;
  v_records    int := 0;
  v_comments   int := 0;
  v_n          int := 0;
begin
  if not has_any_role(array['admin','superadmin']) then
    raise exception 'FORBIDDEN';
  end if;

  select deleted_at, invited_by into v_deleted, v_inviter from profiles where id = p_target;
  if v_deleted is null then
    raise exception 'NOT_DELETED';
  end if;

  if not can_manage_user(p_target) then
    raise exception 'FORBIDDEN';
  end if;

  -- ① 恢复账号
  update profiles
     set deleted_at = null, deleted_by = null, deleted_reason = null
   where id = p_target;

  -- ② 原邀请人已停用 → 重新挂超管（否则恢复后仍是孤儿）
  if v_inviter is not null then
    select (deleted_at is null) into v_inviter_ok from profiles where id = v_inviter;
    if v_inviter_ok is not true then
      select id into v_super
        from profiles
       where role = 'superadmin' and deleted_at is null
       limit 1;
      update profiles set invited_by = v_super where id = p_target;
    end if;
  end if;

  -- ③ 只恢复"随账号隐藏"的内容，审核驳回的不碰
  if p_restore_content then
    update balls
       set state = 1, hidden_reason = null
     where owner_id = p_target and state = 0 and hidden_reason = 'owner_deleted';
    get diagnostics v_n = row_count;
    v_records := v_records + v_n;

    update advanced
       set state = 1, hidden_reason = null
     where owner_id = p_target and state = 0 and hidden_reason = 'owner_deleted';
    get diagnostics v_n = row_count;
    v_records := v_records + v_n;

    update comments
       set deleted_at = null, hidden_reason = null
     where user_id = p_target and deleted_at is not null and hidden_reason = 'owner_deleted';
    get diagnostics v_comments = row_count;
  end if;

  update dataset_meta set version = version + 1, updated_at = now() where id = 1;

  return jsonb_build_object('ok', true, 'restored_records', v_records, 'restored_comments', v_comments);
end $$;

-- ─────────────────────────────────────────────
-- 3. 转移邀请关系（超管专属）
-- ─────────────────────────────────────────────
create or replace function transfer_invitees(p_from uuid, p_to uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int := 0;
begin
  if not is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;
  if p_from = p_to then
    raise exception 'SAME_TARGET';
  end if;
  if not exists (select 1 from profiles where id = p_to and deleted_at is null) then
    raise exception 'TARGET_NOT_FOUND';
  end if;

  update profiles set invited_by = p_to where invited_by = p_from;
  get diagnostics v_n = row_count;

  update dataset_meta set version = version + 1, updated_at = now() where id = 1;

  return v_n;
end $$;

-- ─────────────────────────────────────────────
-- 4. 权限
-- ─────────────────────────────────────────────
revoke execute on function soft_delete_user(uuid, boolean, text) from public, anon;
grant  execute on function soft_delete_user(uuid, boolean, text) to authenticated;

revoke execute on function restore_user(uuid, boolean) from public, anon;
grant  execute on function restore_user(uuid, boolean) to authenticated;

revoke execute on function transfer_invitees(uuid, uuid) from public, anon;
grant  execute on function transfer_invitees(uuid, uuid) to authenticated;
