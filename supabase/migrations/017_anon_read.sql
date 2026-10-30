-- 017 · 匿名可读教学数据（决策 D22）
--
-- 背景
--   原策略全部 `to authenticated`，未登录连快照 RPC 都 401，等于必须登录才能看到任何内容。
--   决策 D22：教学数据（记录 / 字典 / 版本号 / 作者昵称 / 已过审评论）**无需登录即可读**；
--   评论、投稿、审核、改角色等**一切写操作仍需登录**（策略与 RPC 校验不变）。
--
-- 为什么只改角色列表、不改 USING 条件
--   balls_read / adv_read 的条件是：
--     (state = 1 and review_status = 'visible') or owner_id = auth.uid() or has_any_role(...)
--   对 anon：auth.uid() 为 null → `owner_id = null` 恒为 null（不成立），has_any_role 返回 false。
--   所以同一表达式对 anon 天然只放行「已发布」的行，待审/驳回的投稿不会泄露。
--   comments 的 c_read 同理：anon 只命中 status = 'visible'。
--
-- 依赖（不要删）
--   策略表达式以请求者身份求值，anon 需要 has_any_role / is_admin 的 EXECUTE，
--   这两个授权在 015 里已给到 anon。若被收回，未登录读表会 42501 而不是空数组。
--
-- 写权限未动：balls_insert/update、adv_insert/update、c_insert 仍是 `to authenticated`，
--   profiles 的表级 UPDATE 仍被 revoke（013），角色变更仍只能走 set_user_role RPC。

-- ─────────────────────────────────────────────
-- 1. 记录：read 加 anon（条件不变）
-- ─────────────────────────────────────────────
drop policy if exists balls_read on balls;
create policy balls_read on balls for select to anon, authenticated using (
  (state = 1 and review_status = 'visible')
  or owner_id = auth.uid()
  or has_any_role(array['admin', 'superadmin'])
);

drop policy if exists adv_read on advanced;
create policy adv_read on advanced for select to anon, authenticated using (
  (state = 1 and review_status = 'visible')
  or owner_id = auth.uid()
  or has_any_role(array['admin', 'superadmin'])
);

-- ─────────────────────────────────────────────
-- 2. 评论：anon 只能看已过审的（自己/管理员的旁路对 anon 无效）
-- ─────────────────────────────────────────────
drop policy if exists c_read on comments;
create policy c_read on comments for select to anon, authenticated using (
  deleted_at is null and (
    status = 'visible'          -- 公开区
    or user_id = auth.uid()     -- 自己的（含 pending / rejected）
    or is_admin()               -- 管理员看全部
  )
);

-- ─────────────────────────────────────────────
-- 3. 字典 / 版本号 / 作者昵称：anon 全表可读
--
-- profiles 放开的理由：列表页要显示「作者」昵称，未登录也得能显示。
-- 表里只有 id / nickname / avatar / role / created_at，没有邮箱等敏感字段
-- （邮箱只经 list_users RPC 下发，且该 RPC 仅 authenticated）。
-- ─────────────────────────────────────────────
drop policy if exists dict_read on display_dict;
create policy dict_read on display_dict for select to anon, authenticated using (true);

drop policy if exists meta_read on dataset_meta;
create policy meta_read on dataset_meta for select to anon, authenticated using (true);

drop policy if exists p_read on profiles;
create policy p_read on profiles for select to anon, authenticated using (true);

-- ─────────────────────────────────────────────
-- 4. 只读 RPC 给 anon；写 RPC 保持只有 authenticated
--
-- get_dataset_snapshot 是 security definer 且内部已过滤
-- `state = 1 and review_status = 'visible'`，匿名拉不到待审数据。
-- ─────────────────────────────────────────────
grant execute on function get_dataset_snapshot()            to anon;
grant execute on function get_dataset_version()             to anon;
grant execute on function get_comment_counts(text, uuid[])  to anon;
