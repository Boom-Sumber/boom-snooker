-- ============================================================
-- 040 · 待审超时升级（T8.5，D33）
--
-- 目的：管理员超期不在线时，超管要知道"有东西卡住了"。
--   不用 cron（免费额度下没有定时任务，也不想为这个引入 GitHub Actions 依赖 service_role）：
--   **惰性触发** —— 超管打开审核中心时客户端调一次，函数内部自己判断。
--
-- 幂等：同一条待审记录 24 小时内只升级一次（按 target + kind 查重）。
-- 返回：当前**超时的总数**（不只是本次新发的），页面顶部用它显示提示。
--
-- 超时阈值 12 小时：一天内没处理就提醒，太短会吵、太长失去意义。
--
-- 回滚：drop function escalate_stale_pending()
-- ============================================================

create or replace function escalate_stale_pending()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_total int := 0;
begin
  if not is_superadmin() then raise exception 'FORBIDDEN'; end if;

  -- 一条语句搞定：算出超时集合 → 发通知（24h 查重）→ 返回超时总数。
  -- 用 CTE 而不是临时表：临时表在函数里要处理 create/truncate/drop，既慢又容易和 plan cache 打架。
  -- 注：数据修改型 CTE（sent）即使不被主查询引用也会执行完，这是 PostgreSQL 的既定行为。
  with stale as (
    select
      'ball'::text           as rec_type,
      b.id                   as id,
      coalesce(b.method, '') as title,
      o.nickname             as owner_name,
      now() - b.updated_at   as waiting
    from balls b
    left join profiles o on o.id = b.owner_id
    where b.state = 1 and b.review_status = 'pending'
      and b.updated_at < now() - interval '12 hours'

    union all

    select
      'advanced'::text,
      a.id,
      coalesce(a.title, ''),
      o.nickname,
      now() - a.updated_at
    from advanced a
    left join profiles o on o.id = a.owner_id
    where a.state = 1 and a.review_status = 'pending'
      and a.updated_at < now() - interval '12 hours'
  ),
  fresh as (
    select s.*
    from stale s
    where not exists (
      select 1 from notifications n
       where n.kind = 'review_escalated'
         and n.target_type = s.rec_type
         and n.target_id = s.id
         and n.created_at > now() - interval '24 hours'
    )
  ),
  sent as (
    insert into notifications (user_id, kind, title, body, target_type, target_id)
    select
      p.id,
      'review_escalated',
      '待审已超过 12 小时',
      '《' || coalesce(nullif(f.title, ''), '未命名投稿') || '》（作者 ' ||
        coalesce(f.owner_name, '未知') || '）已等待 ' ||
        greatest(1, floor(extract(epoch from f.waiting) / 3600))::int || ' 小时，请及时审核。',
      f.rec_type,
      f.id
    from fresh f
    join profiles p on p.role = 'superadmin' and p.deleted_at is null
    returning 1
  )
  select count(*) into v_total from stale;

  return v_total;
end $$;

revoke execute on function escalate_stale_pending() from public, anon;
grant  execute on function escalate_stale_pending() to authenticated;

comment on function escalate_stale_pending() is
  '待审超时升级（T8.5）：超管打开审核中心时调用；同一记录 24h 内只发一次通知；返回当前超时总数';
