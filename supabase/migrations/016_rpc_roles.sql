-- 016 · RPC 改造：四角色下的写入、审核、用户管理
--
-- 依赖 013 的权限函数（can_write_records / has_any_role / is_superadmin）。
-- 本迁移把 8 个旧 RPC 里「只认 is_admin()」的逻辑改成按角色分流，
-- 并新增 review_record / list_users / set_user_role。

-- ─────────────────────────────────────────────
-- 1. 写入：高级用户 + 管理员，且只能动自己的记录
-- ─────────────────────────────────────────────
create or replace function upsert_ball(p jsonb, expected_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur int; new_id uuid; existing_owner uuid;
begin
  if not can_write_records() then raise exception 'FORBIDDEN'; end if;

  select version into cur from dataset_meta where id = 1;
  if expected_version is not null and cur <> expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  new_id := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());

  -- 改已有记录时，必须先确认归属（管理员也不能改别人的）
  if nullif(p->>'id', '') is not null then
    select owner_id into existing_owner from balls where id = new_id;
    if existing_owner is distinct from auth.uid() then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  insert into balls (id, owner_id, color_code, pocket_code, method, strength_code, sight,
                     low_comp, high_comp, remark, impact_image, blue_image, route_image,
                     state, updated_at, updated_by)
  values (new_id, auth.uid(), p->>'color_code', p->>'pocket_code', p->>'method',
          p->>'strength_code', p->>'sight', p->>'low_comp', p->>'high_comp', p->>'remark',
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

  -- review_status / owner_id 由 trg_balls_review 触发器决定，这里不传
  return jsonb_build_object('id', new_id,
                            'version', (select version from dataset_meta where id = 1));
end $$;

create or replace function delete_ball(p_id uuid, expected_version int)
returns void language plpgsql security definer set search_path = public as $$
declare cur int;
begin
  if not can_write_records() then raise exception 'FORBIDDEN'; end if;

  select version into cur from dataset_meta where id = 1;
  if expected_version is not null and cur <> expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  update balls
     set state = 0, updated_at = now(),
         updated_by = (select nickname from profiles where id = auth.uid())
   where id = p_id and state = 1 and owner_id = auth.uid();

  if not found then raise exception 'FORBIDDEN'; end if;
end $$;

create or replace function upsert_advanced(p jsonb, expected_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur int; new_id uuid; existing_owner uuid;
begin
  if not can_write_records() then raise exception 'FORBIDDEN'; end if;

  select version into cur from dataset_meta where id = 1;
  if expected_version is not null and cur <> expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  new_id := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());

  if nullif(p->>'id', '') is not null then
    select owner_id into existing_owner from advanced where id = new_id;
    if existing_owner is distinct from auth.uid() then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  insert into advanced (id, owner_id, category_code, title, description, content, image,
                        state, updated_at, updated_by)
  values (new_id, auth.uid(), p->>'category_code', p->>'title', p->>'description',
          p->>'content', p->>'image', 1, now(),
          (select nickname from profiles where id = auth.uid()))
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
  if not can_write_records() then raise exception 'FORBIDDEN'; end if;

  select version into cur from dataset_meta where id = 1;
  if expected_version is not null and cur <> expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  update advanced
     set state = 0, updated_at = now(),
         updated_by = (select nickname from profiles where id = auth.uid())
   where id = p_id and state = 1 and owner_id = auth.uid();

  if not found then raise exception 'FORBIDDEN'; end if;
end $$;

-- ─────────────────────────────────────────────
-- 2. 记录审核（仅管理员；超管不参与审核）
-- ─────────────────────────────────────────────
create or replace function review_record(p_type text, p_id uuid,
                                         p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_any_role(array['admin']) then raise exception 'FORBIDDEN'; end if;
  if p_decision not in ('visible', 'rejected') then raise exception 'BAD_DECISION'; end if;

  if p_type = 'ball' then
    update balls
       set review_status = p_decision, reviewed_by = auth.uid(),
           reviewed_at = now(), review_note = p_note
     where id = p_id and review_status = 'pending';
  elsif p_type = 'advanced' then
    update advanced
       set review_status = p_decision, reviewed_by = auth.uid(),
           reviewed_at = now(), review_note = p_note
     where id = p_id and review_status = 'pending';
  else
    raise exception 'BAD_TYPE';
  end if;

  if not found then raise exception 'NOT_PENDING'; end if;
end $$;

-- ─────────────────────────────────────────────
-- 3. 用户管理
-- ─────────────────────────────────────────────
create or replace function list_users()
returns table (id uuid, nickname text, email text, role text, created_at timestamptz)
language plpgsql security definer stable set search_path = public as $$
begin
  if not has_any_role(array['admin', 'superadmin']) then
    raise exception 'FORBIDDEN';
  end if;

  return query
    select p.id, p.nickname, u.email::text, p.role, p.created_at
      from profiles p
      join auth.users u on u.id = p.id
     order by p.created_at;
end $$;

create or replace function set_user_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare target_role text;
begin
  if not has_any_role(array['admin', 'superadmin']) then raise exception 'FORBIDDEN'; end if;
  if p_user_id = auth.uid() then raise exception 'FORBIDDEN'; end if;
  if p_role not in ('viewer', 'advanced', 'admin') then raise exception 'BAD_ROLE'; end if;

  select role into target_role from profiles where id = p_user_id;
  if target_role is null then raise exception 'USER_NOT_FOUND'; end if;
  -- 超管账号不可被任何人调整
  if target_role = 'superadmin' then raise exception 'FORBIDDEN'; end if;

  if not is_superadmin() then
    -- 管理员：只能在 普通 ↔ 高级 之间调
    if p_role = 'admin' or target_role = 'admin' then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  update profiles set role = p_role where id = p_user_id;
end $$;

-- ─────────────────────────────────────────────
-- 4. 快照只下发已审核通过的记录
-- ─────────────────────────────────────────────
create or replace function get_dataset_snapshot() returns jsonb
language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'version',  (select version from dataset_meta where id = 1),
    'balls',    coalesce((select jsonb_agg(to_jsonb(b) order by b.updated_at)
                            from balls b
                           where b.state = 1 and b.review_status = 'visible'), '[]'::jsonb),
    'advanced', coalesce((select jsonb_agg(to_jsonb(a) order by a.updated_at)
                            from advanced a
                           where a.state = 1 and a.review_status = 'visible'), '[]'::jsonb),
    'dict',     coalesce((select jsonb_agg(to_jsonb(d) order by d.kind, d.sort)
                            from display_dict d), '[]'::jsonb)
  );
$$;

-- ─────────────────────────────────────────────
-- 5. 评论审核：is_admin() 现在含超管，但超管不参与审核 → 收紧到仅 admin
-- ─────────────────────────────────────────────
create or replace function review_comment(p_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_any_role(array['admin']) then raise exception 'FORBIDDEN'; end if;
  if p_decision not in ('visible', 'rejected') then raise exception 'BAD_DECISION'; end if;

  update comments
     set status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = p_id and status = 'pending';
end $$;

-- ─────────────────────────────────────────────
-- 6. 授权：新函数只给登录用户
-- ─────────────────────────────────────────────
revoke execute on function review_record(text, uuid, text, text) from public, anon;
revoke execute on function list_users()                          from public, anon;
revoke execute on function set_user_role(uuid, text)             from public, anon;

grant execute on function review_record(text, uuid, text, text) to authenticated;
grant execute on function list_users()                          to authenticated;
grant execute on function set_user_role(uuid, text)             to authenticated;
