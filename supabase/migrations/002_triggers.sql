-- 002 · 触发器
-- 依据 docs/03-数据模型与接口.md 第 1.1 / 1.5 / 2 节
-- 幂等：先 drop trigger if exists 再建

-- ─────────────────────────────────────────────
-- 2.1 注册后自动建 profiles
-- ─────────────────────────────────────────────
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, nickname)
  values (new.id, coalesce(new.raw_user_meta_data->>'nickname', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function handle_new_user();

-- ─────────────────────────────────────────────
-- 2.2 参考数据变更 → dataset_version + 1
--     ⚠️ comments 表绝对不要加这个 trigger（铁律 6）
--
-- security definer 是必需的：dataset_meta 开了 RLS 且没有写策略，
-- 若按 docs/03 原样写成普通函数，管理员绕过 RPC 直接 PATCH /balls 时
-- trigger 会以 authenticated 身份更新 dataset_meta 而被 RLS 拒绝，
-- 导致整条 update 失败。加 security definer 后以函数属主身份执行，行为符合预期。
-- ─────────────────────────────────────────────
create or replace function bump_dataset_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update dataset_meta set version = version + 1, updated_at = now() where id = 1;
  return null;
end $$;

drop trigger if exists trg_balls_changed on balls;
create trigger trg_balls_changed after insert or update on balls
for each row execute function bump_dataset_version();

drop trigger if exists trg_advanced_changed on advanced;
create trigger trg_advanced_changed after insert or update on advanced
for each row execute function bump_dataset_version();

drop trigger if exists trg_dict_changed on display_dict;
create trigger trg_dict_changed after insert or update on display_dict
for each row execute function bump_dataset_version();

-- ─────────────────────────────────────────────
-- 2.3 评论：强制 pending，忽略客户端传值（铁律 5）
-- ─────────────────────────────────────────────
create or replace function force_comment_pending() returns trigger
language plpgsql set search_path = public as $$
begin
  new.status      := 'pending';
  new.user_id     := auth.uid();
  new.created_at  := now();
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;
  new.deleted_at  := null;
  return new;
end $$;

drop trigger if exists trg_comment_pending on comments;
create trigger trg_comment_pending before insert on comments
for each row execute function force_comment_pending();

-- ─────────────────────────────────────────────
-- 2.4 评论频率限制（pending 也计入，防止刷队列）
-- ─────────────────────────────────────────────
create or replace function check_comment_rate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from comments
      where user_id = new.user_id and created_at > now() - interval '1 minute') >= 1 then
    raise exception 'RATE_LIMIT_MINUTE';
  end if;
  if (select count(*) from comments
      where user_id = new.user_id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'RATE_LIMIT_DAY';
  end if;
  return new;
end $$;

drop trigger if exists trg_comment_rate on comments;
create trigger trg_comment_rate before insert on comments
for each row execute function check_comment_rate();
