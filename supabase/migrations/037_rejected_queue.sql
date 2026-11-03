-- ============================================================
-- 037 · 已驳回记录队列（T8.3，D34）
--
-- 口径：`state = 1 and review_status = 'rejected' and hidden_reason is null`
--   · 不是回收站（那是 state=0，作者自己删的）
--   · 不是待审（rejected 已经出过结论）
--   · 这类记录**作者随时可能回来改稿重提**，所以图片和正文都必须留着
--
-- 三个东西：
--   ① `list_rejected_records` 按归属列出（admin 看自己邀请的，超管看全量）
--   ② `remind_rejected` 再次提醒作者，**同一条记录 24h 内只发一次**
--   ③ `purge_record` 扩展来源：允许 state=1 且 rejected；删除前给作者发通知
--      ⚠️ 物理删除**只有超管**（D34），管理员只能提醒
--
-- 回滚：drop 前两个函数；purge_record 恢复成 032 的版本
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. 列表
-- ─────────────────────────────────────────────
create or replace function list_rejected_records(
  p_type   text default null,   -- 'ball' | 'advanced' | null
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  rec_type          text,
  id                uuid,
  title             text,
  owner_id          uuid,
  owner_nickname    text,
  owner_deleted     boolean,
  color_code        text,
  pocket_code       text,
  category_code     text,
  review_note       text,
  reviewed_at       timestamptz,
  reviewer_nickname text,
  reviewer_role     text,
  image_paths       text[],
  total_count       bigint
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (is_superadmin() or has_any_role(array['admin'])) then
    raise exception 'FORBIDDEN';
  end if;
  if p_type is not null and p_type not in ('ball', 'advanced') then
    raise exception 'BAD_TYPE';
  end if;

  return query
  with rejected as (
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
      b.review_note                   as review_note,
      b.reviewed_at                   as reviewed_at,
      r.nickname                      as reviewer_nickname,
      r.role                          as reviewer_role,
      array_remove(array[b.impact_image, b.blue_image, b.route_image], null) as image_paths
    from balls b
    left join profiles p on p.id = b.owner_id
    left join profiles r on r.id = b.reviewed_by
    where b.state = 1 and b.review_status = 'rejected' and b.hidden_reason is null
      and (p_type is null or p_type = 'ball')
      and ((b.owner_id is null and is_superadmin()) or can_review_owner(b.owner_id))

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
      a.review_note,
      a.reviewed_at,
      r.nickname,
      r.role,
      array_remove(array[a.image], null)
    from advanced a
    left join profiles p on p.id = a.owner_id
    left join profiles r on r.id = a.reviewed_by
    where a.state = 1 and a.review_status = 'rejected' and a.hidden_reason is null
      and (p_type is null or p_type = 'advanced')
      and ((a.owner_id is null and is_superadmin()) or can_review_owner(a.owner_id))
  )
  select
    d.rec_type, d.id, d.title, d.owner_id, d.owner_nickname, d.owner_deleted,
    d.color_code, d.pocket_code, d.category_code,
    d.review_note, d.reviewed_at, d.reviewer_nickname, d.reviewer_role,
    d.image_paths,
    count(*) over () as total_count
  from rejected d
  order by d.reviewed_at desc nulls last
  limit greatest(p_limit, 1) offset greatest(p_offset, 0);
end $$;

-- ─────────────────────────────────────────────
-- 2. 再次提醒（24h 冷却）
-- ─────────────────────────────────────────────
create or replace function remind_rejected(p_type text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_owner   uuid;
  v_label   text;
  v_note    text;
  v_found   boolean := false;
begin
  if p_type not in ('ball', 'advanced') then raise exception 'BAD_TYPE'; end if;

  if p_type = 'ball' then
    select b.owner_id, coalesce(b.method, '这条投稿'), b.review_note
      into v_owner, v_label, v_note
      from balls b
     where b.id = p_id and b.state = 1 and b.review_status = 'rejected'
       and b.hidden_reason is null;
    v_found := found;
  else
    select a.owner_id, coalesce(a.title, '这条投稿'), a.review_note
      into v_owner, v_label, v_note
      from advanced a
     where a.id = p_id and a.state = 1 and a.review_status = 'rejected'
       and a.hidden_reason is null;
    v_found := found;
  end if;
  if not v_found then raise exception 'NOT_FOUND'; end if;

  -- 权限：有主行按归属，历史无主行只有超管
  if v_owner is null then
    if not is_superadmin() then raise exception 'FORBIDDEN'; end if;
  elsif not can_review_owner(v_owner) then
    raise exception 'FORBIDDEN';
  end if;

  -- 冷却：同一条记录 24h 内只提醒一次，防止管理员刷屏
  if exists (
    select 1 from notifications n
     where n.user_id = v_owner
       and n.kind = 'record_reminder'
       and n.target_type = p_type
       and n.target_id = p_id
       and n.created_at > now() - interval '24 hours'
  ) then
    raise exception 'REMIND_TOO_SOON';
  end if;

  insert into notifications (user_id, kind, title, body, target_type, target_id)
  values (
    v_owner,
    'record_reminder',
    '你的投稿被驳回后还没有处理',
    '《' || v_label || '》' ||
      case when v_note is null or btrim(v_note) = '' then '' else '：' || v_note end ||
      '。请修改后重新提交，或自行删除；长期不处理会被管理员清理。',
    p_type,
    p_id
  );
end $$;

-- ─────────────────────────────────────────────
-- 3. purge_record 扩展：允许删除"已驳回"的记录
--    只在 032 的基础上加两个分支，其余逻辑（审计 / 清评论通知 / bump / 孤儿图）不变
-- ─────────────────────────────────────────────
create or replace function purge_record(p_type text, p_id uuid)
returns text[]
language plpgsql security definer set search_path = public as $$
declare
  v_row         jsonb;
  v_paths       text[];
  v_is_rejected boolean := false;
  v_owner       uuid;
  v_label       text;
begin
  if not is_superadmin() then raise exception 'FORBIDDEN'; end if;
  if p_type not in ('ball', 'advanced') then raise exception 'BAD_TYPE'; end if;

  -- 两种来源：回收站（state=0）或已驳回待处理（state=1 + rejected）
  if p_type = 'ball' then
    select to_jsonb(b) into v_row
      from balls b
     where b.id = p_id
       and ((b.state = 0 and b.hidden_reason is null)
            or (b.state = 1 and b.review_status = 'rejected' and b.hidden_reason is null));
  else
    select to_jsonb(a) into v_row
      from advanced a
     where a.id = p_id
       and ((a.state = 0 and a.hidden_reason is null)
            or (a.state = 1 and a.review_status = 'rejected' and a.hidden_reason is null));
  end if;
  if v_row is null then raise exception 'NOT_FOUND'; end if;

  v_is_rejected := (v_row->>'review_status' = 'rejected');

  -- ① 审计快照先落（带来源，方便区分"从回收站删"还是"清理驳回记录"）
  perform log_admin_action(
    'purge_record',
    p_id,
    jsonb_build_object(
      'type', p_type,
      'source', case when v_is_rejected then 'rejected' else 'recycle_bin' end,
      'row', v_row
    )
  );

  -- ② 驳回记录被清理：先告知作者（target 置空 —— 记录马上就没了，点开也不该跳转）
  if v_is_rejected then
    v_owner := nullif(v_row->>'owner_id', '')::uuid;
    v_label := coalesce(nullif(v_row->>'title', ''), nullif(v_row->>'method', ''), '这条投稿');
    if v_owner is not null then
      insert into notifications (user_id, kind, title, body, target_type, target_id)
      values (
        v_owner,
        'record_deleted',
        '你的投稿已被删除',
        '《' || v_label || '》驳回后长期未处理，已被超级管理员删除。如需重新投稿请新建一条。',
        null,
        null
      );
    end if;
  end if;

  -- ③ 多态关联的两张表要手动清（没有外键）
  delete from comments      where target_type = p_type and target_id = p_id;
  delete from notifications where target_type = p_type and target_id = p_id;

  -- ④ 删行
  if p_type = 'ball' then
    delete from balls b where b.id = p_id;
  else
    delete from advanced a where a.id = p_id;
  end if;

  -- ⑤ 显式 bump：delete 不触发 trg_balls_changed / trg_advanced_changed
  update dataset_meta set version = version + 1, updated_at = now() where id = 1;

  -- ⑥ 这一行独占的图片：删完之后已无任何记录引用（不分 state / review_status）
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
-- 4. 权限
-- ─────────────────────────────────────────────
revoke execute on function list_rejected_records(text, int, int) from public, anon;
revoke execute on function remind_rejected(text, uuid)            from public, anon;
revoke execute on function purge_record(text, uuid)               from public, anon;

grant execute on function list_rejected_records(text, int, int) to authenticated;
grant execute on function remind_rejected(text, uuid)           to authenticated;
grant execute on function purge_record(text, uuid)              to authenticated;

comment on function list_rejected_records(text, int, int) is
  '已驳回队列（T8.3）：state=1 且 rejected，按 can_review_owner 过滤；超管看全量';
comment on function remind_rejected(text, uuid) is
  '再次提醒作者（T8.3）：同一条记录 24h 内只发一次，超频抛 REMIND_TOO_SOON';
