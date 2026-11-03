-- ============================================================
-- 035 · 修 033/034 的权限缺口 + 孤儿图删除审计
--
-- 问题一：超管删不掉 Storage 对象
--   013 的 `can_write_records()` = has_any_role(['advanced','admin'])，
--   **不包含 superadmin**（D20：超管只做用户权限，不写内容）。
--   而回收站/孤儿图清理是超管专用（T7.2/T7.3），于是 `storage.remove()` 全被 RLS 拒掉 ——
--   界面上表现为"点了删除但什么都没发生"。
--   修法：只给 **delete** 策略补上 `is_superadmin()`。insert / update 不动，
--   超管依然不能上传内容（那是 advanced/admin 的活）。
--
-- 问题二：删图片没有审计
--   `storage.remove()` 走的是 Storage API，不经过任何 RPC，`admin_actions` 里查不到。
--   加一个只写审计的 RPC：`log_orphan_purge(p_paths)`，超管专用，不删任何东西。
--
-- 回滚：drop function log_orphan_purge(text[])；
--       并把 images_admin_delete 策略恢复成 013 的版本（只用 can_write_records()）
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. Storage delete 策略：允许超管
-- ─────────────────────────────────────────────
drop policy if exists "images_admin_delete" on storage.objects;
create policy "images_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'images' and (public.can_write_records() or public.is_superadmin()));

-- ─────────────────────────────────────────────
-- 2. 孤儿图删除审计
-- ─────────────────────────────────────────────
create or replace function log_orphan_purge(p_paths text[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_superadmin() then raise exception 'FORBIDDEN'; end if;
  if p_paths is null or array_length(p_paths, 1) is null then return; end if;

  perform log_admin_action(
    'purge_image',
    null,
    jsonb_build_object(
      'count', array_length(p_paths, 1),
      'paths', to_jsonb(p_paths)
    )
  );
end $$;

revoke execute on function log_orphan_purge(text[]) from public, anon;
grant  execute on function log_orphan_purge(text[]) to authenticated;

comment on function log_orphan_purge(text[]) is
  '孤儿图删除审计（超管）：只写 admin_actions，不删对象 —— 对象由客户端调 Storage API 删';
