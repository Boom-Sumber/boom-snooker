-- ============================================================
-- 034 · 修 033：list_orphan_images 的 sum() 类型不匹配
--
-- 现象：调用直接报 `structure of query does not match function result type`
-- 原因：Postgres 的 `sum(bigint)` 返回 **numeric**，而 033 里
--       `total_bytes` 声明成了 `bigint` —— plpgsql 的 `return query` 会严格比对类型，
--       `count(*) over ()` 是 bigint 所以没事，`sum()` 这一列直接炸。
-- 修法：`sum(o.bytes) over ()::bigint`（孤儿图总量最多几 MB，bigint 绰绰有余）
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
      o.name                                     as path,
      coalesce((o.metadata->>'size')::bigint, 0) as bytes,
      o.created_at                               as created_at
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
    count(*) over ()            as total_count,
    (sum(o.bytes) over ())::bigint as total_bytes
  from orphans o
  order by o.created_at
  limit greatest(p_limit, 1) offset greatest(p_offset, 0);
end $$;

revoke execute on function list_orphan_images(int, int) from public, anon;
grant  execute on function list_orphan_images(int, int) to authenticated;
