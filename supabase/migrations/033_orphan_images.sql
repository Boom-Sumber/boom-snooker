-- ============================================================
-- 033 · 孤儿图清理（T7.3，超管）
--
-- "孤儿"= 桶里有、但**没有任何记录引用**的对象：
--   · 换图后遗留的旧图（upload.ts 明确不删旧图）
--   · 上传成功但保存失败的残留
--   · 记录被物理删除后不再被引用的图
--
-- 为什么必须用 security definer 读 `storage.objects`：
--   ① 只靠业务表永远扫不出"上传成功但没保存"的残留 —— 它压根没进过数据库
--   ② 引用计数**不能按 state / review_status 过滤**：软删、驳回、停用隐藏的行
--      仍然持有路径（它们还要恢复、要改稿），过滤掉就会把共享图误判成孤儿
--
-- 为什么不在删除记录时顺手删图（docs/06 §3）：
--   软删除的行还持有路径，逻辑上算不出孤儿；真要算就得排除本行，那"恢复"必然裂图。
--   所以回收站改成"人工触发的一次性对账"。
--
-- 删除动作由客户端调 Storage API 执行（Storage 对象不能从 SQL 删），
-- 本函数只负责**给出可信的候选列表**。
--
-- 回滚：drop function list_orphan_images(int, int)
-- ============================================================

create or replace function list_orphan_images(
  p_limit  int default 200,
  p_offset int default 0
)
returns table (
  path        text,
  bytes       bigint,
  created_at  timestamptz,
  total_count bigint,
  total_bytes bigint
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_superadmin() then raise exception 'FORBIDDEN'; end if;

  return query
  with orphans as (
    select
      o.name                                    as path,
      coalesce((o.metadata->>'size')::bigint, 0) as bytes,
      o.created_at                              as created_at
    from storage.objects o
    where o.bucket_id = 'images'
      and not exists (
            select 1 from balls b
             where o.name in (b.impact_image, b.blue_image, b.route_image)
          )
      and not exists (select 1 from advanced a where a.image = o.name)
  )
  select
    o.path,
    o.bytes,
    o.created_at,
    count(*) over ()  as total_count,
    sum(o.bytes) over () as total_bytes
  from orphans o
  order by o.created_at
  limit greatest(p_limit, 1) offset greatest(p_offset, 0);
end $$;

revoke execute on function list_orphan_images(int, int) from public, anon;
grant  execute on function list_orphan_images(int, int) to authenticated;

comment on function list_orphan_images(int, int) is
  '孤儿图列表（超管）：桶里没有任何记录引用的对象，含总张数与总体积；引用计数不分 state / review_status';
