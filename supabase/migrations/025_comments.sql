-- ============================================================
-- 025 · 评论读接口 + 发评论（T4.1）
--
-- 背景
--   comments 表 / force_comment_pending / check_comment_rate / review_comment /
--   get_comment_counts 在 001~004 就已经建好，021 又把 c_read 收窄到"归属范围"。
--   缺的只有**读接口**：客户端要一次拿到「正文 + 作者昵称 + 头像 + 性别 + 作者是否已停用」，
--   分页返回。
--
-- 为什么必须用 RPC 而不是直接 select comments
--   1. 021 之后 `p_read on profiles` 只剩「自己 + 自己邀请的 + 超管」，
--      评论区的作者昵称/头像拿不到（评论者往往是别人邀请的普通用户）。
--      RPC 是 security definer，可以在函数内 join profiles 而不放开 profiles 的读策略。
--   2. D30 要求作者昵称旁显示「已停用」—— `author_deleted` 只能靠 join 算出来。
--      评论不进快照（铁律 6），所以这个字段只能随 RPC 实时返回。
--   3. 可见范围要同时表达「公开区 + 自己的（含待审/驳回）+ 有审核权的范围」，
--      写成函数比让前端拼三段查询可靠。
--
-- 不改的东西（别顺手"优化"）
--   · 不加 bump_dataset_version 触发器 —— 铁律 6：评论不能 bump 版本
--   · 不放开 profiles 的读策略 —— 昵称只从 RPC 出，不给整表读权
--   · 不在客户端指定 status / user_id —— 仍由 force_comment_pending 覆盖（铁律 5）
--
-- 回滚：见文末注释
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. 评论列表（分页）
--
--    排序：created_at desc（最新在上，与 idx_comments_public 一致）
--    total：当前调用者**可见**的总条数（不是全表），用于"还有没有下一页"
-- ─────────────────────────────────────────────
create or replace function list_comments(
  p_type      text,
  p_target_id uuid,
  p_limit     int default 20,
  p_offset    int default 0
)
returns table (
  id             uuid,
  content        text,
  status         text,
  created_at     timestamptz,
  user_id        uuid,
  nickname       text,
  avatar         text,
  gender         text,
  author_deleted boolean,
  review_note    text,
  total          bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid;
begin
  if p_type is null or p_type not in ('ball', 'advanced') then
    raise exception 'BAD_TYPE';
  end if;
  if p_target_id is null then
    raise exception 'BAD_TARGET';
  end if;

  -- 分页参数兜底：不信任客户端传值
  if p_limit is null or p_limit <= 0 then p_limit := 20; end if;
  if p_limit > 100 then p_limit := 100; end if;
  if p_offset is null or p_offset < 0 then p_offset := 0; end if;

  -- 已停用账号当 anon（D30）：不看 c.user_id = auth.uid() 这条旁路
  select case
           when exists (
             select 1 from profiles p
              where p.id = auth.uid() and p.deleted_at is null
           ) then auth.uid()
           else null
         end
    into v_uid;

  return query
  select c.id,
         c.content,
         c.status,
         c.created_at,
         c.user_id,
         coalesce(p.nickname, '未知用户')          as nickname,
         p.avatar,
         coalesce(p.gender, 'male')                as gender,
         (p.deleted_at is not null)                as author_deleted,
         -- 驳回原因只给自己的评论看；别人的评论一律不回（避免前台泄露审核口径）
         case when v_uid is not null and c.user_id = v_uid then c.review_note end as review_note,
         count(*) over ()                          as total
    from comments c
    left join profiles p on p.id = c.user_id
   where c.target_type = p_type
     and c.target_id = p_target_id
     and c.deleted_at is null
     and (
       c.status = 'visible'
       or (v_uid is not null and (c.user_id = v_uid or can_review_owner(c.user_id)))
     )
   order by c.created_at desc, c.id desc
   limit p_limit offset p_offset;
end $$;

comment on function list_comments(text, uuid, int, int) is
  '评论分页列表（T4.1）：匿名只看到 visible；自己的看全部三态；有审核权的按归属看。返回 author_deleted 供 D30 标识';

-- ─────────────────────────────────────────────
-- 2. 发评论
--
--    为什么也包一层 RPC：
--      · 校验"目标记录当前可见" —— 不给待审/已隐藏的记录评论（直接 insert 拦不住）
--      · 已停用账号直接拒绝（D30），不用等客户端登出
--      · 错误统一成 token（EMPTY_CONTENT / TOO_LONG / RATE_LIMIT_*），前端好翻中文
--    status / user_id / created_at 仍由 trg_comment_pending 覆盖（铁律 5）
-- ─────────────────────────────────────────────
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
  v_uid    uuid := auth.uid();
  v_text   text := btrim(coalesce(p_content, ''));
  v_visible boolean := false;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from profiles where id = v_uid and deleted_at is null
  ) then
    raise exception 'ACCOUNT_DISABLED';
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
  '发评论（T4.1）：强制 pending（trigger），校验目标可见与账号未停用，限流走 trigger';

-- ─────────────────────────────────────────────
-- 3. 权限
--
--    list_comments：anon 可读（D22 匿名可读已过审评论）
--    create_comment：只有 authenticated（写操作一律需登录）
--    get_comment_counts 的 anon 授权在 017 已给，这里不重复
-- ─────────────────────────────────────────────
revoke execute on function list_comments(text, uuid, int, int) from public;
grant  execute on function list_comments(text, uuid, int, int) to anon, authenticated;

revoke execute on function create_comment(text, uuid, text) from public, anon;
grant  execute on function create_comment(text, uuid, text) to authenticated;

-- ─────────────────────────────────────────────
-- 回滚
--   drop function if exists list_comments(text, uuid, int, int);
--   drop function if exists create_comment(text, uuid, text);
-- ─────────────────────────────────────────────
