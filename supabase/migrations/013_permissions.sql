-- 013 · 四角色权限：函数 + RLS + 触发器
--
-- 目标（D20 / D21）：
--   高级用户 advanced  → 可写记录，但一律 pending
--   管理员   admin     → 可写自己的记录，免审；可审核
--   超管     superadmin→ 只读记录，不参与审核与写入
--
-- 本迁移不含 RPC 改造（014 负责），但会把 RLS 和触发器改到位。

-- ─────────────────────────────────────────────
-- 1. 权限函数
-- ─────────────────────────────────────────────
create or replace function current_role_code() returns text
language sql security definer stable set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid()), 'anon');
$$;

create or replace function has_any_role(roles text[]) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((select role = any(roles) from profiles where id = auth.uid()), false);
$$;

-- 语义升级：管理员或超管。用于「看得到全部数据」的场景，不用于「能写」
create or replace function is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select has_any_role(array['admin','superadmin']);
$$;

create or replace function is_superadmin() returns boolean
language sql security definer stable set search_path = public as $$
  select has_any_role(array['superadmin']);
$$;

-- 能写记录的人：高级用户 + 管理员。图片上传也用这个（高级用户要传图）
create or replace function can_write_records() returns boolean
language sql security definer stable set search_path = public as $$
  select has_any_role(array['advanced','admin']);
$$;

-- ─────────────────────────────────────────────
-- 2. 强制审核状态（客户端传什么都不算数，同 force_comment_pending 思路）
--
-- 为什么必须有：review_status 默认 'visible'，高级用户绕过 RPC 直接
-- POST /balls 并带上 review_status='visible' 就能跳过审核。
-- ─────────────────────────────────────────────
create or replace function force_record_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- owner 永远由服务端决定，防止伪造归属
  if tg_op = 'INSERT' then
    new.owner_id := auth.uid();
  end if;

  if has_any_role(array['admin']) then
    -- 管理员信任：保留其传值（review_record 会显式写入 reviewed_*）
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

drop trigger if exists trg_balls_review on balls;
create trigger trg_balls_review before insert or update on balls
for each row execute function force_record_review();

drop trigger if exists trg_advanced_review on advanced;
create trigger trg_advanced_review before insert or update on advanced
for each row execute function force_record_review();

-- ─────────────────────────────────────────────
-- 3. 记录表 RLS 重写
--    旧策略 balls_write 是 for all + is_admin()，等于管理员能改所有人、超管也能写。
--    现在拆成 read / insert / update，且 delete 不给策略（只能走 RPC 软删）。
-- ─────────────────────────────────────────────
drop policy if exists balls_read   on balls;
drop policy if exists balls_write  on balls;
drop policy if exists balls_insert on balls;
drop policy if exists balls_update on balls;

create policy balls_read on balls for select to authenticated using (
  (state = 1 and review_status = 'visible')   -- 公开可见
  or owner_id = auth.uid()                    -- 自己的（含待审/驳回）
  or has_any_role(array['admin','superadmin'])-- 管理员与超管看全部
);

create policy balls_insert on balls for insert to authenticated
  with check (can_write_records() and owner_id = auth.uid());

create policy balls_update on balls for update to authenticated
  using (can_write_records() and owner_id = auth.uid())
  with check (can_write_records() and owner_id = auth.uid());

drop policy if exists adv_read   on advanced;
drop policy if exists adv_write  on advanced;
drop policy if exists adv_insert on advanced;
drop policy if exists adv_update on advanced;

create policy adv_read on advanced for select to authenticated using (
  (state = 1 and review_status = 'visible')
  or owner_id = auth.uid()
  or has_any_role(array['admin','superadmin'])
);

create policy adv_insert on advanced for insert to authenticated
  with check (can_write_records() and owner_id = auth.uid());

create policy adv_update on advanced for update to authenticated
  using (can_write_records() and owner_id = auth.uid())
  with check (can_write_records() and owner_id = auth.uid());

-- ─────────────────────────────────────────────
-- 4. Storage 写权限：管理员 → 高级用户 + 管理员
-- ─────────────────────────────────────────────
drop policy if exists "images_admin_insert" on storage.objects;
create policy "images_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'images' and public.can_write_records());

drop policy if exists "images_admin_update" on storage.objects;
create policy "images_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'images' and public.can_write_records())
  with check (bucket_id = 'images' and public.can_write_records());

drop policy if exists "images_admin_delete" on storage.objects;
create policy "images_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'images' and public.can_write_records());

-- ─────────────────────────────────────────────
-- 5. profiles：禁止客户端直接改 role
--
-- 新漏洞（T0.6 之后才出现）：guard_profile_role 允许 is_admin() 改角色，
-- 而 is_admin() 现在包含 admin —— 管理员可以 PATCH 自己 profile 把 role
-- 改成 superadmin，直接提权。
-- 修法：撤销表级 UPDATE，只授予 nickname / avatar 两列的更新权。
-- 角色变更只能走 set_user_role RPC（security definer，014 实现）。
-- ─────────────────────────────────────────────
revoke update on profiles from anon, authenticated;
grant update (nickname, avatar) on profiles to authenticated;

-- ─────────────────────────────────────────────
-- 6. dataset_version 只对「可见行」变化 +1
--
-- 旧触发器对每次 insert/update 都 bump，加了审核后会导致：
-- 高级用户提交一条 pending 记录 → 所有客户端白下一次全量快照（6.7 MB）。
-- display_dict 没有 review_status，继续用原来的 bump_dataset_version()。
-- ─────────────────────────────────────────────
create or replace function bump_dataset_version_records() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.state = 1 and new.review_status = 'visible' then
      update dataset_meta set version = version + 1, updated_at = now() where id = 1;
    end if;
  else
    if (new.state = 1 and new.review_status = 'visible')
       or (old.state = 1 and old.review_status = 'visible') then
      update dataset_meta set version = version + 1, updated_at = now() where id = 1;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_balls_changed on balls;
create trigger trg_balls_changed after insert or update on balls
for each row execute function bump_dataset_version_records();

drop trigger if exists trg_advanced_changed on advanced;
create trigger trg_advanced_changed after insert or update on advanced
for each row execute function bump_dataset_version_records();
