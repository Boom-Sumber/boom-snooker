-- ============================================================
-- 036 · 审核链改造（T8.1，D32 / D33）
--
-- 三处改动：
--   ① `force_record_review()` 取消「管理员免审」—— 除审核动作外一律回 pending
--   ② `can_review_owner()` 删掉「自己审自己」旁路
--   ③ `can_review_owner()` 超管改为**全量可审**（修订 D28）
--   ④ `notifications.kind` 扩三种（为 T8.3 的提醒/删除通知、T8.5 的超时升级铺路）
--
-- 为什么 ① 不能简单删掉 admin 分支：
--   触发器同时管「用户提交」和「审核人写结论」两种 update。
--   原来的写法靠 `has_any_role(['admin'])` 区分调用者，删掉分支后
--   `review_record` 把状态改成 visible 时会被触发器又改回 pending，审核直接失效。
--   新写法改成看**语义**：只有「调用者确实有权审这条」时，才允许写入 visible / rejected。
--
-- 注意 owner_id 为空的历史行：`can_review_owner(null)` 恒为 false（沿用 021 的语义），
-- 这类行按 021/027 的既有约定只有超管能审，所以触发器里要单独放行超管。
--
-- 回滚：把两个函数恢复成 013 / 021 的版本；kind 约束恢复成 031 的六个值
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. 提交即待审（含管理员）
-- ─────────────────────────────────────────────
create or replace function force_record_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_review_action boolean := false;
begin
  -- owner 永远由服务端决定，防止伪造归属
  if tg_op = 'INSERT' then
    new.owner_id := auth.uid();
  end if;

  -- 「审核动作」判定：调用方给了结论，且确实有权审这条记录
  if new.review_status in ('visible', 'rejected') then
    if new.owner_id is null then
      v_review_action := is_superadmin();          -- 历史无主行：只有超管能审
    else
      v_review_action := can_review_owner(new.owner_id);
    end if;
  end if;

  if not v_review_action then
    -- 普通提交 / 编辑：一律回待审，并清掉可能伪造的审核痕迹（D32）
    new.review_status := 'pending';
    new.reviewed_by   := null;
    new.reviewed_at   := null;
    new.review_note   := null;
  end if;

  return new;
end $$;

-- 触发器已在 013 建好（before insert or update），这里只替换函数体

-- ─────────────────────────────────────────────
-- 2. 审核范围：去掉自审旁路 + 超管全量
-- ─────────────────────────────────────────────
create or replace function can_review_owner(p_owner uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select case
    when p_owner is null              then false       -- 历史无主行由调用方单独判超管
    when is_superadmin()              then true        -- D33：超管可审全量（兜底）
    when has_any_role(array['admin']) then exists (    -- 管理员：只审自己邀请的
      select 1 from profiles where id = p_owner and invited_by = auth.uid())
    else false
  end;
$$;

comment on function can_review_owner(uuid) is
  'D33：超管全量可审；管理员只审自己邀请的；不再有「自己审自己」旁路';

-- ─────────────────────────────────────────────
-- 3. 通知类型扩展
--    record_reminder  管理员/超管对已驳回记录「再次提醒」（T8.3）
--    record_deleted   超管物理删除驳回记录后告知作者（T8.3）
--    review_escalated 待审超 12h 升级给超管（T8.5）
-- ─────────────────────────────────────────────
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('comment_visible', 'comment_rejected',
                  'record_visible',  'record_rejected',
                  'system', 'role_changed',
                  'record_reminder', 'record_deleted', 'review_escalated'));
