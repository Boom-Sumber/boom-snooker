-- 042 · 应用内更新：版本发布表 + releases 桶
--
-- 背景：安装包 132 MB（T6.3 实测），Supabase Free 单文件上限 50 MB、月出口 5 GB，
--       装不下也发不起 → 二进制放 GitHub 公开 Releases，这里只存**清单与版本元数据**。
--       方案见 docs/10-应用内更新方案.md。
--
-- 读：匿名可读已发布版本（state = 1），客户端启动时用它判断强制更新阈值；
--     latest.yml 走存储桶的 public 路径，不经过这张表。
-- 写：**不给任何客户端角色策略**。只有 service_role（发布脚本，本机）能写 ——
--     能写这张表等于能推任意安装包，必须卡死。

create table if not exists public.app_releases (
  id                    uuid primary key default gen_random_uuid(),
  version               text        not null unique,
  channel               text        not null default 'stable',
  -- 低于此版本的客户端强制更新；为空表示永不强制
  min_supported_version text,
  notes                 text,
  -- GitHub Releases 的绝对下载地址（latest.yml 里 files[].url 用同一个值）
  installer_url         text        not null,
  installer_size        bigint,
  -- base64，与 latest.yml 的 sha512 保持一致，客户端由 electron-updater 校验
  sha512                text        not null,
  blockmap_url          text,
  published_at          timestamptz not null default now(),
  published_by          uuid        references public.profiles (id) on delete set null,
  -- 1 有效 / 0 撤回（回滚用：撤回后客户端看不到这一版）
  state                 smallint    not null default 1 check (state in (0, 1))
);

comment on table public.app_releases is '桌面端发布版本元数据；二进制在 GitHub Releases，清单在 Storage，本表管策略与审计';

create index if not exists app_releases_latest_idx
  on public.app_releases (channel, published_at desc)
  where state = 1;

alter table public.app_releases enable row level security;

-- 客户端只读；没有任何 insert/update/delete 策略 → 除 service_role 外一律写不进
drop policy if exists "app_releases_read" on public.app_releases;
create policy "app_releases_read" on public.app_releases
  for select to anon, authenticated
  using (state = 1);

-- 存储桶：只放 latest.yml（几百字节）。public 读、无人可写（service_role 绕过 RLS）
insert into storage.buckets (id, name, public)
values ('releases', 'releases', true)
on conflict (id) do update set public = true;

-- 保险：即便以后有人给 releases 桶开了写策略，也只允许超管走客户端写
drop policy if exists "releases_superadmin_insert" on storage.objects;
create policy "releases_superadmin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'releases' and public.is_superadmin());

drop policy if exists "releases_superadmin_update" on storage.objects;
create policy "releases_superadmin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'releases' and public.is_superadmin())
  with check (bucket_id = 'releases' and public.is_superadmin());

drop policy if exists "releases_superadmin_delete" on storage.objects;
create policy "releases_superadmin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'releases' and public.is_superadmin());
