-- 003 · RLS 策略 + is_admin + profiles 权限加固
-- 依据 docs/03-数据模型与接口.md 第 3 节
-- 幂等：先 drop policy if exists 再建

-- ─────────────────────────────────────────────
-- 3.1 管理员判定
-- ─────────────────────────────────────────────
create or replace function is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- ─────────────────────────────────────────────
-- 3.2 开启 RLS
-- ─────────────────────────────────────────────
alter table balls        enable row level security;
alter table advanced     enable row level security;
alter table display_dict enable row level security;
alter table dataset_meta enable row level security;
alter table profiles     enable row level security;
alter table comments     enable row level security;

-- ─────────────────────────────────────────────
-- 3.3 参考数据：登录用户只读，管理员可写
-- ─────────────────────────────────────────────
drop policy if exists balls_read on balls;
create policy balls_read on balls for select using (auth.role() = 'authenticated');

drop policy if exists balls_write on balls;
create policy balls_write on balls for all using (is_admin()) with check (is_admin());

drop policy if exists adv_read on advanced;
create policy adv_read on advanced for select using (auth.role() = 'authenticated');

drop policy if exists adv_write on advanced;
create policy adv_write on advanced for all using (is_admin()) with check (is_admin());

drop policy if exists dict_read on display_dict;
create policy dict_read on display_dict for select using (auth.role() = 'authenticated');

drop policy if exists meta_read on dataset_meta;
create policy meta_read on dataset_meta for select using (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────
-- 3.4 用户资料：只能改自己那行
-- ─────────────────────────────────────────────
drop policy if exists p_read on profiles;
create policy p_read on profiles for select using (auth.role() = 'authenticated');

drop policy if exists p_update on profiles;
create policy p_update on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ⚠️ 安全加固（docs/03 未覆盖，见 02-进度日志 2026-10-28）
-- docs/03 的 p_update 只限制「行属于自己」，没限制「改哪些列」。
-- 普通用户因此可以 PATCH /profiles?id=eq.<自己> {"role":"admin"} 把自己提成管理员，
-- 整条评论先审后发的链路就形同虚设。
-- 这里用 BEFORE UPDATE 触发器把 role 回滚成原值，管理员改角色不受影响。
create or replace function guard_profile_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not is_admin() then
    new.role := old.role;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_profile_role on profiles;
create trigger trg_guard_profile_role before update on profiles
for each row execute function guard_profile_role();

-- ─────────────────────────────────────────────
-- 3.5 评论：核心是读策略
-- ─────────────────────────────────────────────
drop policy if exists c_read on comments;
create policy c_read on comments for select using (
  deleted_at is null and (
    status = 'visible'          -- 公开区
    or user_id = auth.uid()     -- 自己的（含 pending / rejected）
    or is_admin()               -- 管理员看全部
  )
);

drop policy if exists c_insert on comments;
create policy c_insert on comments for insert with check (user_id = auth.uid());

-- 不给 update / delete 策略：审核走 RPC，删除由管理员在 Dashboard 操作
