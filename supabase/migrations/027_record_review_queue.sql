-- ============================================================
-- 027 · 记录审核队列（T4.5）
--
-- 背景（2026-11-02 发现的缺口）
--   高级用户投稿后记录是 `review_status = 'pending'`（D21），但一直**没有界面能审**：
--   全仓只有 `review_record` RPC，管理员得知道 id 才能审。
--   结果就是"投稿 → 永远 pending"，闭环断在记录这一侧。
--
-- 这里补两个只读函数，与 026 的评论队列同构：
--   list_pending_records(p_limit, p_offset)  —— 队列（彩球 + 进阶合并，按提交时间正序）
--   count_pending_records()                  —— 角标计数
--
-- 范围与 review_record 完全一致（021）：
--   · admin 只看自己邀请的人写的
--   · 超管看 `invited_by is null` 的（"直邀"）
--   · 历史数据 `owner_id is null` 的只有超管能审
--
-- 为什么要回 `preview`（jsonb）
--   待审记录**不在快照里**（快照只下发 visible），所以点不进详情页 ——
--   审核者必须能在队列里直接读到内容（瞄准 / 高低杆 / 补充说明、描述 / 注解）。
--   只回文字字段，不回图片路径：图在 Storage，审核看文字足够判断。
--
-- 注意
--   `create or replace` 改不了 returns table 的列，所以这里先 drop 再建（本文件可重复执行）。
--
-- 回滚：见文末注释
-- ============================================================

drop function if exists list_pending_records(int, int);

create function list_pending_records(
  p_limit  int default 50,
  p_offset int default 0
)
returns table (
  record_type     text,
  id              uuid,
  color_code      text,
  pocket_code     text,
  method          text,
  strength_code   text,
  category_code   text,
  title           text,
  preview         jsonb,
  created_at      timestamptz,
  owner_id        uuid,
  nickname        text,
  author_deleted  boolean,
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
  with pending as (
    -- 彩球
    select 'ball'::text as record_type, b.id,
           b.color_code, b.pocket_code, b.method, b.strength_code,
           null::text as category_code, null::text as title,
           jsonb_build_object(
             'sight',    b.sight,
             'low_comp', b.low_comp,
             'high_comp', b.high_comp,
             'remark',   b.remark
           ) as preview,
           b.created_at, b.owner_id
      from balls b
     where b.state = 1
       and b.review_status = 'pending'
       and (
         (b.owner_id is null and is_superadmin())
         or can_review_owner(b.owner_id)
       )

    union all

    -- 进阶
    select 'advanced'::text, a.id,
           null::text, null::text, null::text, null::text,
           a.category_code, a.title,
           jsonb_build_object(
             'description', a.description,
             'content',     a.content
           ),
           a.created_at, a.owner_id
      from advanced a
     where a.state = 1
       and a.review_status = 'pending'
       and (
         (a.owner_id is null and is_superadmin())
         or can_review_owner(a.owner_id)
       )
  )
  select p.record_type,
         p.id,
         p.color_code,
         p.pocket_code,
         p.method,
         p.strength_code,
         p.category_code,
         p.title,
         p.preview,
         p.created_at,
         p.owner_id,
         coalesce(pr.nickname, '未知用户') as nickname,
         (pr.deleted_at is not null)       as author_deleted,
         count(*) over ()                  as total
    from pending p
    left join profiles pr on pr.id = p.owner_id
   -- 先提交先审，和评论队列一致
   order by p.created_at asc, p.id asc
   limit p_limit offset p_offset;
end $$;

comment on function list_pending_records(int, int) is
  '待审记录队列（T4.5）：彩球 + 进阶合并，范围同 review_record（归属 / 直邀 / 历史空 owner 归超管），带文字预览';

create or replace function count_pending_records()
returns bigint
language sql
security definer
stable
set search_path = public
as $$
  select case
    when has_any_role(array['admin', 'superadmin']) then (
      (select count(*) from balls b
        where b.state = 1 and b.review_status = 'pending'
          and ((b.owner_id is null and is_superadmin()) or can_review_owner(b.owner_id)))
      +
      (select count(*) from advanced a
        where a.state = 1 and a.review_status = 'pending'
          and ((a.owner_id is null and is_superadmin()) or can_review_owner(a.owner_id)))
    )
    else 0::bigint
  end;
$$;

comment on function count_pending_records() is
  '待审记录数（T4.5）：非管理员返回 0，顶部角标轮询用';

revoke execute on function list_pending_records(int, int) from public, anon;
grant  execute on function list_pending_records(int, int) to authenticated;

revoke execute on function count_pending_records() from public, anon;
grant  execute on function count_pending_records() to authenticated;

-- ─────────────────────────────────────────────
-- 回滚
--   drop function if exists list_pending_records(int, int);
--   drop function if exists count_pending_records();
-- ─────────────────────────────────────────────
