-- 004 · RPC + 授权
-- 依据 docs/03-数据模型与接口.md 第 4 节
-- 所有函数 security definer + 固定 search_path（避免 search_path 注入，也消掉 advisor 告警）
-- 授权原则：只给 authenticated，显式 revoke public / anon
--   —— create function 默认 grant execute to PUBLIC，不 revoke 的话未登录用户
--      可以直接 POST /rest/v1/rpc/get_dataset_snapshot 把全部数据拉走。

-- ─────────────────────────────────────────────
-- 4.1 快照
-- ─────────────────────────────────────────────
create or replace function get_dataset_version() returns int
language sql security definer stable set search_path = public as $$
  select version from dataset_meta where id = 1;
$$;

create or replace function get_dataset_snapshot() returns jsonb
language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'version',  (select version from dataset_meta where id = 1),
    'balls',    coalesce((select jsonb_agg(to_jsonb(b) order by b.updated_at)
                            from balls b where b.state = 1), '[]'::jsonb),
    'advanced', coalesce((select jsonb_agg(to_jsonb(a) order by a.updated_at)
                            from advanced a where a.state = 1), '[]'::jsonb),
    'dict',     coalesce((select jsonb_agg(to_jsonb(d) order by d.kind, d.sort)
                            from display_dict d), '[]'::jsonb)
  );
$$;

-- ─────────────────────────────────────────────
-- 4.2 写入（乐观并发：expected_version 不匹配则 VERSION_CONFLICT）
-- ─────────────────────────────────────────────
create or replace function upsert_ball(p jsonb, expected_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur int; new_id uuid;
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;

  select version into cur from dataset_meta where id = 1;
  if expected_version is not null and cur <> expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  new_id := coalesce(nullif(p->>'id','')::uuid, gen_random_uuid());

  insert into balls (id, color_code, pocket_code, method, strength_code, sight,
                     low_comp, high_comp, remark, impact_image, blue_image, route_image,
                     state, updated_at, updated_by)
  values (new_id, p->>'color_code', p->>'pocket_code', p->>'method', p->>'strength_code',
          p->>'sight', p->>'low_comp', p->>'high_comp', p->>'remark',
          p->>'impact_image', p->>'blue_image', p->>'route_image',
          1, now(), (select nickname from profiles where id = auth.uid()))
  on conflict (id) do update set
    color_code    = excluded.color_code,
    pocket_code   = excluded.pocket_code,
    method        = excluded.method,
    strength_code = excluded.strength_code,
    sight         = excluded.sight,
    low_comp      = excluded.low_comp,
    high_comp     = excluded.high_comp,
    remark        = excluded.remark,
    impact_image  = excluded.impact_image,
    blue_image    = excluded.blue_image,
    route_image   = excluded.route_image,
    state         = 1,
    updated_at    = now(),
    updated_by    = excluded.updated_by;

  return jsonb_build_object('id', new_id,
                            'version', (select version from dataset_meta where id = 1));
end $$;

create or replace function delete_ball(p_id uuid, expected_version int)
returns void language plpgsql security definer set search_path = public as $$
declare cur int;
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;

  select version into cur from dataset_meta where id = 1;
  if expected_version is not null and cur <> expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  update balls
     set state = 0, updated_at = now(),
         updated_by = (select nickname from profiles where id = auth.uid())
   where id = p_id and state = 1;
end $$;

create or replace function upsert_advanced(p jsonb, expected_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur int; new_id uuid;
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;

  select version into cur from dataset_meta where id = 1;
  if expected_version is not null and cur <> expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  new_id := coalesce(nullif(p->>'id','')::uuid, gen_random_uuid());

  insert into advanced (id, category_code, title, description, content, image,
                        state, updated_at, updated_by)
  values (new_id, p->>'category_code', p->>'title', p->>'description', p->>'content',
          p->>'image', 1, now(), (select nickname from profiles where id = auth.uid()))
  on conflict (id) do update set
    category_code = excluded.category_code,
    title         = excluded.title,
    description   = excluded.description,
    content       = excluded.content,
    image         = excluded.image,
    state         = 1,
    updated_at    = now(),
    updated_by    = excluded.updated_by;

  return jsonb_build_object('id', new_id,
                            'version', (select version from dataset_meta where id = 1));
end $$;

create or replace function delete_advanced(p_id uuid, expected_version int)
returns void language plpgsql security definer set search_path = public as $$
declare cur int;
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;

  select version into cur from dataset_meta where id = 1;
  if expected_version is not null and cur <> expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  update advanced
     set state = 0, updated_at = now(),
         updated_by = (select nickname from profiles where id = auth.uid())
   where id = p_id and state = 1;
end $$;

-- ─────────────────────────────────────────────
-- 4.3 审核
-- ─────────────────────────────────────────────
create or replace function review_comment(p_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_decision not in ('visible','rejected') then raise exception 'BAD_DECISION'; end if;

  update comments
     set status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = p_id and status = 'pending';
end $$;

-- ─────────────────────────────────────────────
-- 4.4 评论数
-- ─────────────────────────────────────────────
create or replace function get_comment_counts(p_type text, p_ids uuid[])
returns table (target_id uuid, cnt bigint)
language sql security definer stable set search_path = public as $$
  select c.target_id, count(*)
    from comments c
   where c.status = 'visible' and c.deleted_at is null
     and c.target_type = p_type and c.target_id = any(p_ids)
   group by c.target_id;
$$;

-- ─────────────────────────────────────────────
-- 4.5 授权：先收掉默认的 PUBLIC / anon，再只给 authenticated
-- ─────────────────────────────────────────────
revoke execute on function is_admin()                            from public, anon;
revoke execute on function get_dataset_version()                 from public, anon;
revoke execute on function get_dataset_snapshot()                from public, anon;
revoke execute on function upsert_ball(jsonb, int)               from public, anon;
revoke execute on function delete_ball(uuid, int)                from public, anon;
revoke execute on function upsert_advanced(jsonb, int)           from public, anon;
revoke execute on function delete_advanced(uuid, int)            from public, anon;
revoke execute on function review_comment(uuid, text, text)      from public, anon;
revoke execute on function get_comment_counts(text, uuid[])      from public, anon;

grant execute on function is_admin()                            to authenticated;
grant execute on function get_dataset_version()                 to authenticated;
grant execute on function get_dataset_snapshot()                to authenticated;
grant execute on function upsert_ball(jsonb, int)               to authenticated;
grant execute on function delete_ball(uuid, int)                to authenticated;
grant execute on function upsert_advanced(jsonb, int)           to authenticated;
grant execute on function delete_advanced(uuid, int)            to authenticated;
grant execute on function review_comment(uuid, text, text)      to authenticated;
grant execute on function get_comment_counts(text, uuid[])      to authenticated;
