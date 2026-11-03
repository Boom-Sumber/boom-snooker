-- ============================================================
-- 038 · 超管不参与内容生产（T8.2，D35）
--
-- 现状：`can_write_records()` 本来就只含 advanced/admin，所以超管**发不了记录、传不了图**
--       （`upsert_*` / Storage insert 都会拒绝）。
--       但 `create_comment()` 只校验「已登录 + 账号未停用」，超管能评论 —— 与 D35 冲突。
--
-- 处理：在 `create_comment` 里显式拒绝超管。
--       注意超管仍然能**审核**评论（走 `review_comment`，那是管理写，不是内容写）。
--
-- 回滚：把 create_comment 恢复成 025 / 030 的版本（去掉 is_superadmin 判断）
-- ============================================================

create or replace function create_comment(
  p_type      text,
  p_target_id uuid,
  p_content   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_text    text := btrim(coalesce(p_content, ''));
  v_visible boolean := false;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from profiles where id = v_uid and deleted_at is null
  ) then
    raise exception 'ACCOUNT_DISABLED';
  end if;
  -- D35：超管只做全局管控，不参与内容生产（审核评论走 review_comment）
  if is_superadmin() then
    raise exception 'SUPERADMIN_NO_COMMENT';
  end if;
  if p_type is null or p_type not in ('ball', 'advanced') then
    raise exception 'BAD_TYPE';
  end if;
  if char_length(v_text) = 0 then
    raise exception 'EMPTY_CONTENT';
  end if;
  if char_length(v_text) > 300 then
    raise exception 'TOO_LONG';
  end if;

  -- 目标必须存在且已发布（待审 / 已隐藏的记录不开放评论）
  if p_type = 'ball' then
    select exists (
      select 1 from balls
       where id = p_target_id and state = 1 and review_status = 'visible'
    ) into v_visible;
  else
    select exists (
      select 1 from advanced
       where id = p_target_id and state = 1 and review_status = 'visible'
    ) into v_visible;
  end if;

  if not v_visible then
    raise exception 'TARGET_NOT_FOUND';
  end if;

  -- 频率限制由 trg_comment_rate 抛 RATE_LIMIT_MINUTE / RATE_LIMIT_DAY
  insert into comments (target_type, target_id, user_id, content)
  values (p_type, p_target_id, v_uid, v_text)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'status', 'pending');
end $$;

comment on function create_comment(text, uuid, text) is
  '发评论（T4.1/D35）：强制 pending，校验目标可见与账号未停用，超管不可评论，限流走 trigger';
