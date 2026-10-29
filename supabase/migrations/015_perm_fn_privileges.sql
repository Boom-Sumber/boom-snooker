-- 015 · 权限函数的 EXECUTE 收紧
--
-- 013 新建了 6 个函数，默认 grant execute to public，导致：
--   ① 触发器函数 bump_dataset_version_records / force_record_review 被暴露成 RPC
--      （直接调用会报 "trigger functions can only be called as triggers"，纯噪音）
--   ② current_role_code / is_superadmin 未登录也能调（返回 anon / false，不泄露数据但没必要）
--
-- 必须保留 anon EXECUTE 的三个：is_admin / has_any_role / can_write_records
--   —— 它们出现在 RLS 策略表达式里，策略以请求者身份求值。
--   若 anon 无执行权，未登录读表会返回 42501 permission denied 而不是干净的空数组
--   （T0.2 踩过一次，见 docs/03 第 8 节差异 #7）。

-- 触发器函数：谁都不需要直接调用（触发器执行不检查 EXECUTE 权限）
revoke execute on function bump_dataset_version_records() from public, anon, authenticated;
revoke execute on function force_record_review()          from public, anon, authenticated;

-- 工具函数：登录用户可用（客户端可能想知道自己的角色），未登录不需要
revoke execute on function current_role_code() from public, anon;
revoke execute on function is_superadmin()     from public, anon;
grant  execute on function current_role_code() to authenticated;
grant  execute on function is_superadmin()     to authenticated;

-- 策略函数：anon 必须保留（原因见上）
grant execute on function has_any_role(text[])  to anon, authenticated;
grant execute on function can_write_records()   to anon, authenticated;
grant execute on function is_admin()            to anon, authenticated;
