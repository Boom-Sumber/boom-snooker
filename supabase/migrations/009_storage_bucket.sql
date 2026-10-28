-- 009 · Storage：images bucket + 写权限
--
-- 读：bucket 设 public，客户端用 /storage/v1/object/public/images/<path> 直接取，
--     不走 RLS，也不需要给 anon 开 select 策略。
-- 写：只允许管理员。storage.objects 默认开着 RLS，没有策略就谁都写不进去。
--
-- 图片实际体积：326 张 PNG / 77 MB（T0.3 实测），WebP(q80) 后预计 ~20 MB。

insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do update set public = true;

-- 幂等：先删再建
drop policy if exists "images_admin_insert" on storage.objects;
create policy "images_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'images' and public.is_admin());

drop policy if exists "images_admin_update" on storage.objects;
create policy "images_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'images' and public.is_admin())
  with check (bucket_id = 'images' and public.is_admin());

drop policy if exists "images_admin_delete" on storage.objects;
create policy "images_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'images' and public.is_admin());
