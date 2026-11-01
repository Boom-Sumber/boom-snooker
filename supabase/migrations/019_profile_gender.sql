-- 019 · 个人资料：性别字段 + 自助改昵称/头像
--
-- 背景（用户需求）：
--   1. profiles 要能标识性别，客户端据此显示不同默认头像（avatar-boy / avatar-girl）
--   2. 用户可以自己改昵称和头像（角色仍然只能由管理员通过 set_user_role 改）
--
-- 为什么 gender 用 text + check 而不是 boolean：以后要加"保密"或更多选项时，
-- 加一个 check 值比改类型省事；也不会出现 is_male 这种字段名读不懂的情况。
--
-- 注意：013 已经 `revoke update on profiles` 并只授予 (nickname, avatar)，
-- 这里必须把 gender 也加进列级授权，否则客户端改性别会被权限拒绝。

-- ─────────────────────────────────────────────
-- 1. gender 字段
-- ─────────────────────────────────────────────
alter table profiles
  add column if not exists gender text not null default 'male';

alter table profiles drop constraint if exists profiles_gender_check;
alter table profiles add constraint profiles_gender_check
  check (gender in ('male', 'female'));

-- 昵称：1~24 字符（trim 后非空），防止注册/改资料时传空串把列表刷成空白
alter table profiles drop constraint if exists profiles_nickname_check;
alter table profiles add constraint profiles_nickname_check
  check (char_length(btrim(nickname)) between 1 and 24);

-- ─────────────────────────────────────────────
-- 2. 注册时带上昵称与性别
--    Supabase signUp 的 options.data 会落到 raw_user_meta_data
--    （D13：开放注册 + 关闭邮箱确认，注册即登录）
-- ─────────────────────────────────────────────
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta_nickname text;
  meta_gender   text;
begin
  meta_nickname := nullif(btrim(coalesce(new.raw_user_meta_data->>'nickname', '')), '');
  meta_gender   := new.raw_user_meta_data->>'gender';

  insert into profiles (id, nickname, gender)
  values (
    new.id,
    -- 没传昵称就退回邮箱前缀；再截到 24 字符，避免撞上 nickname check
    left(coalesce(meta_nickname, split_part(new.email, '@', 1)), 24),
    case when meta_gender in ('male', 'female') then meta_gender else 'male' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- ─────────────────────────────────────────────
-- 3. 列级更新权：昵称 / 头像 / 性别
--    role 仍然不给 —— 角色只能走 set_user_role RPC（014）
-- ─────────────────────────────────────────────
revoke update on profiles from anon, authenticated;
grant update (nickname, avatar, gender) on profiles to authenticated;
