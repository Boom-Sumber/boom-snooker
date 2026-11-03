-- ============================================================
-- 032 · 回收站（超管）：已软删除记录的列表 / 恢复 / 物理删除
--
-- 背景见 docs/06 §5。三条设计约束：
--   ① **只处理"作者主动删除"**（`state = 0 and hidden_reason is null`）。
--      `hidden_reason = 'owner_deleted'` 是停用账号的级联隐藏，由「账户管理 → 恢复账号」
--      统一还原，混进回收站会诱导超管单独恢复、破坏 D29 的还原链路。
--   ② **驳回不是删除**：`review_status = 'rejected'` 的记录 `state` 仍是 1，不进回收站。
--   ③ **物理删除要留痕**：复用 023 的 `admin_actions`（不另起表），
--      先把整行 `to_jsonb(row)` 写进 `detail`，再删数据 —— 顺序反了就没法追溯。
--
-- 物理删除的连带处理（`comments` / `notifications` 是多态关联、没有外键）：
--   删评论 → 删通知 → 删行 → **显式 bump `dataset_version`**（触发器只挂 insert/update）
--   → 返回"删完之后变成孤儿"的图片路径（交给 T7.3 清理）
--
-- 回滚：drop function 三个 + drop 相关 grant（admin_actions 保留，它是 023 的）
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. 列表
-- ─────────────────────────────────────────────
create or replace function list_deleted_records(
  p_type   text default null,   -- 'ball' | 'advanced' | null
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  rec_type       text,
  id             uuid,
  title          text,
  owner_id       uuid,
  owner_nickname text,
  owner_deleted  boolean,
  color_code     text,
  pocket_code    text,
  category_code  text,
  review_status  text,
  deleted_at     timestamptz,
  image_paths    text[],
  total_count    bigint
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_superadmin() then raise exception 'FORBIDDEN'; end if;
  if p_type is not null and p_type not in ('ball', 'advanced') then
    raise exception 'BAD_TYPE';
  end if;

  return query
  with deleted as (
    select
      'ball'::text                    as rec_type,
      b.id                            as id,
      coalesce(b.method, '')          as title,
      b.owner_id                      as owner_id,
      p.nickname                      as owner_nickname,
      (p.deleted_at is not null)      as owner_deleted,
      b.color_code                    as color_code,
      b.pocket_code                   as pocket_code,
      null::text                      as category_code,
      b.review_status                 as review_status,
      b.updated_at                    as deleted_at,   -- 删除时会更新 updated_at，当作删除时间
      array_remove(array[b.impact_image, b.blue_image, b.route_image], null) as image_paths
    from balls b
    left join profiles p on p.id = b.owner_id
    where b.state = 0 and b.hidden_reason is null
      and (p_type is null or p_type = 'ball')

    union all

    select
      'advanced'::text,
      a.id,
      coalesce(a.title, ''),
      a.owner_id,
      p.nickname,
      (p.deleted_at is not null),
      null::text,
      null::text,
      a.category_code,
      a.review_status,
      a.updated_at,
      array_remove(array[a.image], null)
    from advanced a
    left join profiles p on p.id = a.owner_id
    where a.state = 0 and a.hidden_reason is null
      and (p_type is null or p_type = 'advanced')
  )
  select
    d.rec_type, d.id, d.title, d.owner_id, d.owner_nickname, d.owner_deleted,
    d.color_code, d.pocket_code, d.category_code, d.review_status, d.deleted_at,
    d.image_paths,
    count(*) over () as total_count
  from deleted d
  order by d.deleted_at desc
  limit greatest(p_limit, 1) offset greatest(p_offset, 0);
end $$;

-- ─────────────────────────────────────────────
-- 2. 恢复
-- ─────────────────────────────────────────────
create or replace function restore_record(p_type text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_owner         uuid;
  v_owner_deleted timestamptz;
  v_found         boolean := false;
begin
  if not is_superadmin() then raise exception 'FORBIDDEN'; end if;
  if p_type not in ('ball', 'advanced') then raise exception 'BAD_TYPE'; end if;

  if p_type = 'ball' then
    select b.owner_id into v_owner
      from balls b
     where b.id = p_id and b.state = 0 and b.hidden_reason is null;
    v_found := found;
  else
    select a.owner_id into v_owner
      from advanced a
     where a.id = p_id and a.state = 0 and a.hidden_reason is null;
    v_found := found;
  end if;
  if not v_found then raise exception 'NOT_FOUND'; end if;

  -- 作者可能在记录被删之后才被停用：这种恢复等于把停用账号的内容放出来
  if v_owner is not null then
    select pr.deleted_at into v_owner_deleted from profiles pr where pr.id = v_owner;
    if v_owner_deleted is not null then raise exception 'OWNER_DISABLED'; end if;
  end if;

  if p_type = 'ball' then
    update balls b set state = 1, hidden_reason = null, updated_at = now() where b.id = p_id;
  else
    update advanced a set state = 1, hidden_reason = null, updated_at = now() where a.id = p_id;
  end if;

  perform log_admin_action('restore_record', p_id, jsonb_build_object('type', p_type));
end $$;

-- ─────────────────────────────────────────────
-- 3. 物理删除
-- ─────────────────────────────────────────────
create or replace function purge_record(p_type text, p_id uuid)
returns text[]
language plpgsql security definer set search_path = public as $$
declare
  v_row   jsonb;
  v_paths text[];
begin
  if not is_superadmin() then raise exception 'FORBIDDEN'; end if;
  if p_type not in ('ball', 'advanced') then raise exception 'BAD_TYPE'; end if;

  -- 只允许从回收站删（state = 0），防止别处误调用删掉在用记录
  if p_type = 'ball' then
    select to_jsonb(b) into v_row
      from balls b
     where b.id = p_id and b.state = 0 and b.hidden_reason is null;
  else
    select to_jsonb(a) into v_row
      from advanced a
     where a.id = p_id and a.state = 0 and a.hidden_reason is null;
  end if;
  if v_row is null then raise exception 'NOT_FOUND'; end if;

  -- ① 审计快照先落，再删数据（顺序不能反）
  perform log_admin_action(
    'purge_record',
    p_id,
    jsonb_build_object('type', p_type, 'row', v_row)
  );

  -- ② 多态关联的两张表要手动清（没有外键）
  delete from comments      where target_type = p_type and target_id = p_id;
  delete from notifications where target_type = p_type and target_id = p_id;

  -- ③ 删行
  if p_type = 'ball' then
    delete from balls b where b.id = p_id and b.state = 0 and b.hidden_reason is null;
  else
    delete from advanced a where a.id = p_id and a.state = 0 and a.hidden_reason is null;
  end if;

  -- ④ 显式 bump：delete 不触发 trg_balls_changed / trg_advanced_changed
  update dataset_meta set version = version + 1, updated_at = now() where id = 1;

  -- ⑤ 这一行独占的图片：删完之后已无任何记录引用（不分 state / review_status）
  if p_type = 'ball' then
    v_paths := array_remove(
      array[v_row->>'impact_image', v_row->>'blue_image', v_row->>'route_image'],
      null
    );
  else
    v_paths := array_remove(array[v_row->>'image'], null);
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_paths
    from unnest(v_paths) as x
   where not exists (
           select 1 from balls b
            where b.impact_image = x or b.blue_image = x or b.route_image = x
         )
     and not exists (select 1 from advanced a where a.image = x);

  return v_paths;
end $$;

-- ─────────────────────────────────────────────
-- 4. 权限：只给 authenticated，函数内部再校验超管
-- ─────────────────────────────────────────────
revoke execute on function list_deleted_records(text, int, int) from public, anon;
revoke execute on function restore_record(text, uuid)          from public, anon;
revoke execute on function purge_record(text, uuid)            from public, anon;

grant execute on function list_deleted_records(text, int, int) to authenticated;
grant execute on function restore_record(text, uuid)           to authenticated;
grant execute on function purge_record(text, uuid)             to authenticated;

comment on function list_deleted_records(text, int, int) is
  '回收站列表（超管）：只含 state=0 且 hidden_reason is null 的记录，即作者主动删除的';
comment on function restore_record(text, uuid) is
  '从回收站恢复（超管）：作者仍停用时抛 OWNER_DISABLED';
comment on function purge_record(text, uuid) is
  '物理删除（超管）：先写 admin_actions 快照，再删评论/通知/行，bump 版本，返回新增孤儿图路径';
