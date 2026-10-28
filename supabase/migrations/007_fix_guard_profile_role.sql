-- 007 · 修正 guard_profile_role：不该拦服务端改角色
--
-- 003 里的版本条件写成
--   if new.role is distinct from old.role and not is_admin() then new.role := old.role;
-- 问题：在服务端上下文（SQL Editor / execute_sql / service_role）里 auth.uid() 为 null，
-- is_admin() 恒 false，于是**连管理员自己都没法把别人设成 admin**——
-- 实测 update profiles set role='admin' 后 role 仍是 viewer，被静默回滚。
--
-- 正确语义：只有「带着登录用户身份」的请求才需要防提权；
-- 服务端（auth.uid() is null）应放行，否则永远无法产生第一个管理员。

create or replace function guard_profile_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null        -- 服务端上下文（SQL Editor / service_role）放行
     and not is_admin() then
    new.role := old.role;
  end if;
  return new;
end $$;
