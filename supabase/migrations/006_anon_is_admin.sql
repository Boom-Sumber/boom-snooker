-- 006 · 允许 anon 执行 is_admin()，避免未登录请求报 42501
--
-- 现象：收掉 anon 的 is_admin EXECUTE 后，未登录访问 /rest/v1/balls 会返回
--   401 {"code":"42501","message":"permission denied for function is_admin"}
-- 而不是干净的 401/空数组。原因是 RLS 策略表达式里调用了 is_admin()，
-- 策略求值以请求者身份执行，anon 没权限就抛错。
--
-- 为什么放行是安全的：is_admin() 内部是
--   exists (select 1 from profiles where id = auth.uid() and role = 'admin')
-- anon 的 auth.uid() 为 null，恒返回 false，不泄露任何数据。
-- 放行后未登录请求会走正常 RLS 判定，得到 200 [] 或 401（JWT 无效时）。
--
-- 代价：get_advisors 会多报 1 条 anon_security_definer_function_executable（WARN），
-- 已知可接受，见 02-进度日志 2026-10-28 T0.2 条目。

grant execute on function is_admin() to anon;
