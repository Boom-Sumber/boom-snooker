-- ============================================================
-- 020 · 邀请制注册（D27）
--
-- 目标：新用户必须持有效邀请码才能注册，注册后自动挂到邀请人名下。
--
-- 为什么校验放在 trigger 里：
--   signUp 是 GoTrue 的公开端点，**没有注册前钩子**（D12 排除了 Edge Function，
--   而且 EF 同样拦不住，只是多一跳）。唯一能强制拦截的位置就是
--   auth.users 的 AFTER INSERT 触发器 —— RAISE EXCEPTION 会让整个事务回滚，
--   用户根本建不出来。
--
-- 已知取舍：GoTrue 会把异常包成 "Database error saving new user"，
--   自定义中文提示**透不出来**。所以客户端的 validate_invite_code() 预校验
--   不是锦上添花，是唯一的 UX 入口（见 docs/03 §10.2）。
--
-- ⚠️ 绝对不要用 `auth.uid() is null` 判断"服务端上下文"来放行：
--   GoTrue 插入 auth.users 时本身就是 service_role，auth.uid() 也是 null，
--   放行等于所有客户端注册都绕过校验。
--
-- 回滚：
--   drop function if exists invite_code_of(uuid);
--   drop function if exists reset_invite_code_of(uuid);
--   drop function if exists reset_my_invite_code();
--   drop function if exists my_invite_code();
--   drop function if exists validate_invite_code(text);
--   drop function if exists ensure_invite_code(uuid);
--   drop function if exists gen_invite_code();
--   drop table if exists invite_codes;
--   alter table profiles drop column if exists invited_by, drop column if exists invited_at,
--                        drop column if exists invite_code;
--   -- handle_new_user 回滚到 019 版本（见 019_profile_gender.sql）
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. 邀请码表
--    一人一码：重置 = 旧码 disabled_at 置值 + 插新码（不设使用上限）
-- ─────────────────────────────────────────────
create table if not exists invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  inviter_id  uuid not null references profiles(id) on delete cascade,
  disabled_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_invite_codes_inviter
  on invite_codes (inviter_id) where disabled_at is null;

-- 邀请码只走 security definer 函数，不给任何 select 策略
alter table invite_codes enable row level security;

comment on table invite_codes is
  'D27 邀请码：每个 admin/superadmin 一个，可重置（旧码 disabled）。客户端永远读不到整表。';

-- ─────────────────────────────────────────────
-- 2. profiles 归属字段
--    列级授权（019 已 revoke update + 只 grant nickname/avatar/gender）自动覆盖新列，
--    客户端无法直改 invited_by，不需要额外处理。
-- ─────────────────────────────────────────────
alter table profiles
  add column if not exists invited_by  uuid references profiles(id) on delete set null,
  add column if not exists invited_at  timestamptz,
  add column if not exists invite_code text;   -- 注册时用了哪个码（审计用）

create index if not exists idx_profiles_invited_by on profiles (invited_by);

comment on column profiles.invited_by is
  'D28 归属：谁邀请的。null = 历史账号 / 超管直邀 / 已被提升为 admin';
comment on column profiles.invite_code is
  '注册时使用的邀请码（留档，不参与权限判断）';

-- ─────────────────────────────────────────────
-- 3. 码生成
--    字母表去掉 0/O/1/I/L（与图形验证码同一套考虑），31 个字符 × 12 位 ≈ 59.5 bit
-- ─────────────────────────────────────────────
create or replace function gen_invite_code() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result   text := '';
  i        int;
begin
  for i in 1..12 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end $$;

-- 取（或懒生成）某人的有效码。内部函数，不对外 grant。
create or replace function ensure_invite_code(p_uid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  select code into v_code
    from invite_codes
   where inviter_id = p_uid and disabled_at is null
   order by created_at desc
   limit 1;

  if v_code is not null then
    return v_code;
  end if;

  -- 撞码概率极低（59.5 bit），但 unique 冲突要能自愈
  loop
    v_code := gen_invite_code();
    begin
      insert into invite_codes (code, inviter_id) values (v_code, p_uid);
      return v_code;
    exception when unique_violation then
      null;
    end;
  end loop;
end $$;

-- ─────────────────────────────────────────────
-- 4. 注册触发器改造（强制校验 + 写归属）
-- ─────────────────────────────────────────────
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta_nickname text;
  meta_gender   text;
  meta_code     text;
  code_row      invite_codes;
begin
  meta_nickname := nullif(btrim(coalesce(new.raw_user_meta_data->>'nickname', '')), '');
  meta_gender   := new.raw_user_meta_data->>'gender';
  meta_code     := upper(nullif(btrim(coalesce(new.raw_user_meta_data->>'invite_code', '')), ''));

  -- ① 没有码：直接拒绝（D27）
  if meta_code is null then
    raise exception 'INVITE_CODE_REQUIRED';
  end if;

  -- ② 码无效 / 已停用：拒绝
  select * into code_row
    from invite_codes
   where code = meta_code and disabled_at is null;
  if not found then
    raise exception 'INVITE_CODE_INVALID';
  end if;

  -- ③ 归属只信 code：**忽略** metadata 里的 invited_by / role，防客户端伪造
  insert into profiles (id, nickname, gender, invited_by, invited_at, invite_code)
  values (
    new.id,
    left(coalesce(meta_nickname, split_part(new.email, '@', 1)), 24),
    case when meta_gender in ('male','female') then meta_gender else 'male' end,
    code_row.inviter_id,
    now(),
    meta_code
  )
  on conflict (id) do nothing;

  return new;
end $$;

-- ─────────────────────────────────────────────
-- 5. 对外 RPC
-- ─────────────────────────────────────────────

-- 5.1 预校验（anon 可调）——只回 ok/reason，不泄露邀请人
create or replace function validate_invite_code(p_code text) returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_code text;
  v_row  invite_codes;
begin
  v_code := upper(btrim(coalesce(p_code, '')));
  if v_code = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  select * into v_row from invite_codes where code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.disabled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;

  return jsonb_build_object('ok', true, 'reason', 'ok');
end $$;

-- 5.2 我的码（admin+，懒生成）
create or replace function my_invite_code() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not has_any_role(array['admin','superadmin']) then
    raise exception 'FORBIDDEN';
  end if;
  return ensure_invite_code(v_uid);
end $$;

-- 5.3 重置我的码（admin+）
create or replace function reset_my_invite_code() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not has_any_role(array['admin','superadmin']) then
    raise exception 'FORBIDDEN';
  end if;

  update invite_codes
     set disabled_at = now()
   where inviter_id = v_uid and disabled_at is null;

  return ensure_invite_code(v_uid);
end $$;

-- 5.4 超管查看 / 重置某个管理员的码
create or replace function invite_code_of(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from profiles where id = p_user and role in ('admin','superadmin')) then
    raise exception 'NOT_INVITER';
  end if;
  return ensure_invite_code(p_user);
end $$;

create or replace function reset_invite_code_of(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from profiles where id = p_user and role in ('admin','superadmin')) then
    raise exception 'NOT_INVITER';
  end if;

  update invite_codes
     set disabled_at = now()
   where inviter_id = p_user and disabled_at is null;

  return ensure_invite_code(p_user);
end $$;

-- ─────────────────────────────────────────────
-- 6. 权限（照 005/015 的做法：先全撤，再按需 grant）
-- ─────────────────────────────────────────────
revoke execute on function gen_invite_code()        from public, anon, authenticated;
revoke execute on function ensure_invite_code(uuid) from public, anon, authenticated;

revoke execute on function validate_invite_code(text) from public;
grant  execute on function validate_invite_code(text) to anon, authenticated;

revoke execute on function my_invite_code()          from public, anon;
grant  execute on function my_invite_code()          to authenticated;

revoke execute on function reset_my_invite_code()    from public, anon;
grant  execute on function reset_my_invite_code()    to authenticated;

revoke execute on function invite_code_of(uuid)      from public, anon;
grant  execute on function invite_code_of(uuid)      to authenticated;

revoke execute on function reset_invite_code_of(uuid) from public, anon;
grant  execute on function reset_invite_code_of(uuid) to authenticated;

-- ─────────────────────────────────────────────
-- 7. 回填说明
--    现有账号 invited_by 保持 null（= 历史账号，只有超管可见可管，Q10）。
--    邀请码不预生成：第一次打开账户管理页时 my_invite_code() 懒生成。
--    185 条记录的 owner_id 不受影响。
-- ─────────────────────────────────────────────
