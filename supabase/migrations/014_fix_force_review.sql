-- 014 · 修正 force_record_review：服务端上下文应放行
--
-- 013 里的写法：
--   if has_any_role(array['admin']) then ... else new.review_status := 'pending'; end if;
-- 问题：在服务端上下文（SQL Editor / execute_sql / service_role）里 auth.uid() 为 null，
-- has_any_role() 恒 false，于是**连管理员在 SQL 里改状态也会被强制打回 pending**。
-- 实测：update balls set review_status='visible' 之后 RETURNING 仍是 'pending'。
--
-- 这与 T0.2 修 guard_profile_role 时踩的是同一个坑：
-- 「没有登录身份」不等于「是普通用户」，服务端必须放行，否则运维和迁移都没法做。

create or replace function force_record_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, auth.uid());
  end if;

  if auth.uid() is null then
    -- 服务端上下文：信任调用方（迁移、运维脚本、service_role）
    if new.review_status is null then
      new.review_status := 'visible';
    end if;
  elsif has_any_role(array['admin']) then
    -- 管理员：保留其传值（review_record 会显式写入 reviewed_*）
    if new.review_status is null then
      new.review_status := 'visible';
    end if;
  else
    -- 高级用户：一律回待审，并清掉可能伪造的审核痕迹
    new.review_status := 'pending';
    new.reviewed_by   := null;
    new.reviewed_at   := null;
    new.review_note   := null;
  end if;

  return new;
end $$;
