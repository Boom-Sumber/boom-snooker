-- ============================================================
-- 026 · 评论审核队列（T4.3）
--
-- 背景
--   `review_comment` 在 021 就按归属收窄好了，但**没有"列出待审"的接口**：
--   管理员只能盲审（知道 id 才能审），顶部角标也没数据可轮询。
--   这里补两个只读函数：队列 + 计数。
--
-- 为什么不用 `select * from comments where status='pending'`
--   1. 021 之后 `c_read` 只放行「公开 / 自己的 / 有审核权的」，管理员看得到待审，
--      但**作者昵称拿不到**（profiles 只对自己邀请的人可读）—— 审核时得知道是谁投的
--   2. 审核要看"这条评论挂在哪个记录上"，得 join `balls` / `advanced` 拿标题
--   3. 排序与分页写在函数里，前端不用重复拼
--
-- 不改的东西
--   · 不改 `review_comment`（021 已实现范围校验 + 审计触发器 023）
--   · 不加任何 bump（铁律 6：评论不影响 dataset_version）
--
-- 回滚：见文末注释
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. 待审评论队列
--
--    范围：只有 admin / superadmin 能调，且只看**自己有权审的**
--          （`can_review_owner`：admin 看自己邀请的，超管看直邀的）
--    排序：created_at asc —— 审核队列按先来先审，不是按最新
-- ─────────────────────────────────────────────
create or replace function list_pending_comments(
  p_limit  int default 50,
  p_offset int default 0
)
returns table (
  id              uuid,
  content         text,
  created_at      timestamptz,
  user_id         uuid,
  nickname        text,
  author_deleted  boolean,
  target_type     text,
  target_id       uuid,
  target_color    text,
  target_pocket   text,
  target_method   text,
  target_title    text,
  target_category text,
  total           bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not has_any_role(array['admin', 'superadmin']) then
    raise exception 'FORBIDDEN';
  end if;

  if p_limit is null or p_limit <= 0 then p_limit := 50; end if;
  if p_limit > 200 then p_limit := 200; end if;
  if p_offset is null or p_offset < 0 then p_offset := 0; end if;

  return query
  select c.id,
         c.content,
         c.created_at,
         c.user_id,
         coalesce(p.nickname, '未知用户') as nickname,
         (p.deleted_at is not null)       as author_deleted,
         c.target_type,
         c.target_id,
         b.color_code                     as target_color,
         b.pocket_code                    as target_pocket,
         b.method                         as target_method,
         a.title                          as target_title,
         a.category_code                  as target_category,
         count(*) over ()                 as total
    from comments c
    left join profiles p on p.id = c.user_id
    left join balls    b on c.target_type = 'ball'     and b.id = c.target_id
    left join advanced a on c.target_type = 'advanced' and a.id = c.target_id
   where c.status = 'pending'
     and c.deleted_at is null
     and can_review_owner(c.user_id)
   order by c.created_at asc, c.id asc
   limit p_limit offset p_offset;
end $$;

comment on function list_pending_comments(int, int) is
  '待审评论队列（T4.3）：按归属范围过滤，join 作者与目标记录，供审核对话框使用';

-- ─────────────────────────────────────────────
-- 2. 待审计数（顶部角标轮询用）
--    与队列同源同条件，避免"角标有数字、点进去是空的"
-- ─────────────────────────────────────────────
create or replace function count_pending_comments()
returns bigint
language sql
security definer
stable
set search_path = public
as $$
  select case
    when has_any_role(array['admin', 'superadmin']) then (
      select count(*)
        from comments c
       where c.status = 'pending'
         and c.deleted_at is null
         and can_review_owner(c.user_id)
    )
    else 0::bigint
  end;
$$;

comment on function count_pending_comments() is
  '待审评论数（T4.3）：非管理员返回 0，顶部角标轮询用';

-- ─────────────────────────────────────────────
-- 3. 权限：只给登录用户，范围在函数里判（非管理员调会 FORBIDDEN / 0）
-- ─────────────────────────────────────────────
revoke execute on function list_pending_comments(int, int) from public, anon;
grant  execute on function list_pending_comments(int, int) to authenticated;

revoke execute on function count_pending_comments() from public, anon;
grant  execute on function count_pending_comments() to authenticated;

-- ─────────────────────────────────────────────
-- 回滚
--   drop function if exists list_pending_comments(int, int);
--   drop function if exists count_pending_comments();
-- ─────────────────────────────────────────────
