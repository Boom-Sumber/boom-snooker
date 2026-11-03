-- ============================================================
-- 039 · 最近处理（T8.4）
--
-- 用途：审核中心页面底部的「最近处理」列表。
--   超管代审了某个管理员范围内的记录时，该管理员要能在这里看到
--   「由 超管 xxx 审核 · 时间 [已通过/未通过]」，避免重复处理、也知道发生了什么。
--
-- 范围：按 `can_review_owner(owner_id)` —— 管理员看自己邀请的人的内容，
--       超管看全量（D33 之后成立）。管理员**自己的**记录不在其中（他们看通知即可）。
--
-- 回滚：drop function list_recent_reviews(int)
-- ============================================================

create or replace function list_recent_reviews(p_limit int default 20)
returns table (
  rec_type          text,
  id                uuid,
  title             text,
  owner_nickname    text,
  reviewer_nickname text,
  reviewer_role     text,
  decision          text,
  review_note       text,
  reviewed_at       timestamptz
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (is_superadmin() or has_any_role(array['admin'])) then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select * from (
    select
      'ball'::text as rec_type,
      b.id         as id,
      coalesce(b.method, '') as title,
      o.nickname   as owner_nickname,
      r.nickname   as reviewer_nickname,
      r.role       as reviewer_role,
      b.review_status as decision,
      b.review_note   as review_note,
      b.reviewed_at   as reviewed_at
    from balls b
    left join profiles o on o.id = b.owner_id
    left join profiles r on r.id = b.reviewed_by
    where b.reviewed_at is not null
      and b.review_status in ('visible', 'rejected')
      and ((b.owner_id is null and is_superadmin()) or can_review_owner(b.owner_id))

    union all

    select
      'advanced'::text,
      a.id,
      coalesce(a.title, ''),
      o.nickname,
      r.nickname,
      r.role,
      a.review_status,
      a.review_note,
      a.reviewed_at
    from advanced a
    left join profiles o on o.id = a.owner_id
    left join profiles r on r.id = a.reviewed_by
    where a.reviewed_at is not null
      and a.review_status in ('visible', 'rejected')
      and ((a.owner_id is null and is_superadmin()) or can_review_owner(a.owner_id))
  ) t
  order by t.reviewed_at desc
  limit greatest(p_limit, 1);
end $$;

revoke execute on function list_recent_reviews(int) from public, anon;
grant  execute on function list_recent_reviews(int) to authenticated;

comment on function list_recent_reviews(int) is
  '最近处理（T8.4）：审核中心底部用，按 can_review_owner 过滤，带审核人昵称与角色（超管代审可见）';
