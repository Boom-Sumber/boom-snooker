-- 005 · 收紧触发器函数的 EXECUTE 权限
--
-- 背景：get_advisors(security) 报 anon_security_definer_function_executable，
-- 4 个触发器函数（无参数、SECURITY DEFINER）被 PostgREST 暴露成
-- /rest/v1/rpc/<name>，未登录也能"调用"。
-- 实际直接调用会报 "trigger functions can only be called as triggers"，
-- 属于噪音而非真实漏洞；但既然它们只该由触发器调用，就没有理由保留 EXECUTE。
--
-- 注意：PostgreSQL 执行触发器时**不检查** EXECUTE 权限，所以 revoke 不影响触发器正常工作。
--
-- 保留 EXECUTE 的只有 8 个业务 RPC + is_admin()（RLS 策略里要用），
-- 它们本来就是给登录用户调的，advisor 会继续报 WARN —— 这是 D12「不用 Edge Function、
-- 逻辑放 Postgres」的必然结果，属已知可接受项。

revoke execute on function bump_dataset_version() from public, anon, authenticated;
revoke execute on function check_comment_rate()    from public, anon, authenticated;
revoke execute on function guard_profile_role()    from public, anon, authenticated;
revoke execute on function handle_new_user()       from public, anon, authenticated;
