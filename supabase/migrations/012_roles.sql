-- 012 · 四角色 schema（D20 / D21）
--
-- 1. profiles.role 从 2 值扩到 4 值
-- 2. 现有 admin@snooker.local 升为超管；admin2@snooker.local 作为内容管理员
-- 3. 超管唯一用部分唯一索引保证（不靠代码约定）
-- 4. balls / advanced 加归属与审核字段，并回填历史数据
--
-- 注意：本迁移只改结构，不改权限。权限（RLS / 触发器 / RPC）在 013、014。

-- ─────────────────────────────────────────────
-- 1. 角色枚举扩到 4 值
-- ─────────────────────────────────────────────
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('viewer', 'advanced', 'admin', 'superadmin'));

-- ─────────────────────────────────────────────
-- 2. 角色分配
--    admin@  → superadmin（系统管理员，唯一，不管记录）
--    admin2@ → admin（内容管理员，负责审核与日常维护）
--    用 email 定位而不是硬编码 uuid，便于在其他环境重放
-- ─────────────────────────────────────────────
update profiles
   set role = 'superadmin'
 where id = (select id from auth.users where email = 'admin@snooker.local');

update profiles
   set role = 'admin',
       nickname = '内容管理员'
 where id = (select id from auth.users where email = 'admin2@snooker.local');

-- ─────────────────────────────────────────────
-- 3. 超管全库唯一
-- ─────────────────────────────────────────────
create unique index if not exists uq_profiles_single_superadmin
  on profiles ((role)) where role = 'superadmin';

-- ─────────────────────────────────────────────
-- 4. 记录表加归属与审核字段（balls / advanced 同构）
-- ─────────────────────────────────────────────
alter table balls
  add column if not exists owner_id      uuid references auth.users(id) on delete set null,
  add column if not exists created_at    timestamptz,
  add column if not exists review_status text not null default 'visible'
      check (review_status in ('pending','visible','rejected')),
  add column if not exists reviewed_by   uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at   timestamptz,
  add column if not exists review_note   text;

alter table advanced
  add column if not exists owner_id      uuid references auth.users(id) on delete set null,
  add column if not exists created_at    timestamptz,
  add column if not exists review_status text not null default 'visible'
      check (review_status in ('pending','visible','rejected')),
  add column if not exists reviewed_by   uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at   timestamptz,
  add column if not exists review_note   text;

-- ─────────────────────────────────────────────
-- 5. 回填历史数据（185 行）
--    owner 归「内容管理员」而不是超管：超管没有记录写权限，
--    归超管会让这批数据变成谁都不能改的死数据。
--    created_at 用 updated_at 作近似（旧库没记创建时间）。
-- ─────────────────────────────────────────────
update balls set owner_id = (select id from profiles where role = 'admin' order by created_at limit 1)
 where owner_id is null;
update advanced set owner_id = (select id from profiles where role = 'admin' order by created_at limit 1)
 where owner_id is null;

update balls    set created_at = updated_at where created_at is null;
update advanced set created_at = updated_at where created_at is null;

alter table balls    alter column created_at set default now();
alter table advanced alter column created_at set default now();
alter table balls    alter column created_at set not null;
alter table advanced alter column created_at set not null;

-- ─────────────────────────────────────────────
-- 6. 索引
-- ─────────────────────────────────────────────
create index if not exists idx_balls_pending
  on balls (created_at desc) where review_status = 'pending' and state = 1;
create index if not exists idx_balls_owner
  on balls (owner_id) where state = 1;
create index if not exists idx_advanced_pending
  on advanced (created_at desc) where review_status = 'pending' and state = 1;
create index if not exists idx_advanced_owner
  on advanced (owner_id) where state = 1;
