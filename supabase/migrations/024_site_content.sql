-- ============================================================
-- 024 · 站点文案入库（首页文案可由超管在线编辑）
--
-- 为什么放数据库 + 走快照，而不是做成"在线接口"：
--   ① 客户端是**离线优先**（D3/D22）：文案必须和教学数据一样进快照，
--      断网也能显示，否则首页会开天窗
--   ② 改文案要 bump `dataset_version`，所有客户端下次启动自动更新，
--      不用发版
--   ③ 只读公开（anon 也能读），写只走 RPC + 超管校验
--
-- 结构：`site_sections`（分组）+ `site_points`（条目），一对一多。
--   用两张表而不是一个 jsonb 大字段：单条编辑不用整篇覆盖，
--   并发改也不会互相踩（虽然现在只有一个超管）。
--
-- `page` 列留给以后：现在只有 'home'，将来关于页 / 小键盘说明可以复用同一套。
--
-- 回滚：drop function save_site_section(jsonb) / delete_site_section(text);
--       drop table site_points, site_sections;
--       -- get_dataset_snapshot 从 023 之后的版本恢复（去掉 'content' 键）
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. 表
-- ─────────────────────────────────────────────
create table if not exists site_sections (
  key        text primary key,
  page       text not null default 'home',
  title      text not null,
  intro      text,
  sort       int  not null default 0,
  updated_at timestamptz not null default now(),
  constraint site_sections_title_check check (char_length(btrim(title)) between 1 and 40),
  constraint site_sections_intro_check check (intro is null or char_length(intro) <= 200)
);

create table if not exists site_points (
  id          uuid primary key default gen_random_uuid(),
  section_key text not null references site_sections(key) on delete cascade,
  label       text,
  body        text not null,
  sort        int  not null default 0,
  updated_at  timestamptz not null default now(),
  constraint site_points_label_check check (label is null or char_length(btrim(label)) between 1 and 12),
  constraint site_points_body_check  check (char_length(btrim(body)) between 1 and 500)
);

create index if not exists idx_site_points_section on site_points (section_key, sort);
create index if not exists idx_site_sections_page  on site_sections (page, sort);

comment on table site_sections is '站点文案分组（D31）。随快照下发，改完 bump 版本';
comment on column site_points.body is '条目正文；列名不用 text，避免和类型名混淆';

-- ─────────────────────────────────────────────
-- 2. RLS：公开可读，写只走 RPC
-- ─────────────────────────────────────────────
alter table site_sections enable row level security;
alter table site_points   enable row level security;

drop policy if exists ss_read on site_sections;
create policy ss_read on site_sections for select to anon, authenticated using (true);

drop policy if exists sp_read on site_points;
create policy sp_read on site_points for select to anon, authenticated using (true);

-- 不给 insert / update / delete 策略：只能由下面的 security definer 函数写

-- ─────────────────────────────────────────────
-- 3. RPC（超管专属）
-- ─────────────────────────────────────────────

-- 保存一个分组（含它的全部条目，整组覆盖）
-- p_section: { key, page?, title, intro?, sort?, points: [{ label?, body }] }
create or replace function save_site_section(p_section jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_key   text;
  v_page  text;
  v_title text;
  v_intro text;
  v_sort  int;
  v_point jsonb;
  v_i     int := 0;
begin
  if not is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  v_key   := nullif(btrim(coalesce(p_section->>'key', '')), '');
  v_title := nullif(btrim(coalesce(p_section->>'title', '')), '');
  v_page  := coalesce(nullif(btrim(coalesce(p_section->>'page', '')), ''), 'home');
  v_intro := nullif(btrim(coalesce(p_section->>'intro', '')), '');
  v_sort  := coalesce((p_section->>'sort')::int, 0);

  if v_key is null then
    raise exception 'KEY_REQUIRED';
  end if;
  if v_title is null then
    raise exception 'TITLE_REQUIRED';
  end if;

  insert into site_sections (key, page, title, intro, sort)
  values (v_key, v_page, v_title, v_intro, v_sort)
  on conflict (key) do update
     set page       = excluded.page,
         title      = excluded.title,
         intro      = excluded.intro,
         sort       = excluded.sort,
         updated_at = now();

  -- 整组覆盖：先清空再按顺序写回（条目有 id 但前端不依赖它）
  delete from site_points where section_key = v_key;

  for v_point in select * from jsonb_array_elements(coalesce(p_section->'points', '[]'::jsonb))
  loop
    if coalesce(btrim(coalesce(v_point->>'body', '')), '') = '' then
      continue;   -- 空条目直接跳过，不让空行进库
    end if;

    insert into site_points (section_key, label, body, sort)
    values (
      v_key,
      nullif(btrim(coalesce(v_point->>'label', '')), ''),
      btrim(v_point->>'body'),
      v_i
    );
    v_i := v_i + 1;
  end loop;

  update dataset_meta set version = version + 1, updated_at = now() where id = 1;
end $$;

create or replace function delete_site_section(p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_superadmin() then
    raise exception 'FORBIDDEN';
  end if;

  delete from site_sections where key = p_key;

  update dataset_meta set version = version + 1, updated_at = now() where id = 1;
end $$;

revoke execute on function save_site_section(jsonb)   from public, anon;
grant  execute on function save_site_section(jsonb)   to authenticated;
revoke execute on function delete_site_section(text)  from public, anon;
grant  execute on function delete_site_section(text)  to authenticated;

-- ─────────────────────────────────────────────
-- 4. 快照带上文案（离线可用）
-- ─────────────────────────────────────────────
create or replace function get_dataset_snapshot() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version',  (select version from dataset_meta where id = 1),
    'balls',    coalesce((
      select jsonb_agg(
               to_jsonb(b) || jsonb_build_object('author_deleted', exists(
                 select 1 from profiles p where p.id = b.owner_id and p.deleted_at is not null
               )) order by b.updated_at)
        from balls b
       where b.state = 1 and b.review_status = 'visible'), '[]'::jsonb),
    'advanced', coalesce((
      select jsonb_agg(
               to_jsonb(a) || jsonb_build_object('author_deleted', exists(
                 select 1 from profiles p where p.id = a.owner_id and p.deleted_at is not null
               )) order by a.updated_at)
        from advanced a
       where a.state = 1 and a.review_status = 'visible'), '[]'::jsonb),
    'dict',     coalesce((select jsonb_agg(to_jsonb(d) order by d.kind, d.sort)
                            from display_dict d), '[]'::jsonb),
    'content',  coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'key',   s.key,
                 'title', s.title,
                 'intro', s.intro,
                 'sort',  s.sort,
                 'points', coalesce((
                   select jsonb_agg(jsonb_build_object('label', p.label, 'body', p.body) order by p.sort)
                     from site_points p
                    where p.section_key = s.key), '[]'::jsonb)
               ) order by s.sort, s.key)
        from site_sections s
       where s.page = 'home'), '[]'::jsonb)
  );
$$;

-- ─────────────────────────────────────────────
-- 5. 种子：把当前首页文案灌进去（之后由超管在线改）
-- ─────────────────────────────────────────────
insert into site_sections (key, page, title, intro, sort) values
  ('home:statement', 'home', '声明', null, 0),
  ('home:tips',      'home', '阅读前需要知道的几件事',
   '下面这些概念在每条打法里都会用到，先看一遍能省很多来回。', 1)
on conflict (key) do nothing;

insert into site_points (section_key, label, body, sort) values
  ('home:statement', '用途',
   '本程序用于学习 2D 桌球（斯诺克）的走位与技巧，纯绿色工具，不是外挂，也抵制任何形式的外挂。', 0),
  ('home:statement', '致谢',
   '感谢各位大佬提供的帮助与数据资料：微言、秋叶之殇、爱之彦玉 等。', 1),
  ('home:statement', '使用前提',
   '所有数据都基于小键盘操作。小键盘设置教程见「更多 → 小键盘设置」，按自己的系统版本选择即可。', 2),
  ('home:statement', '数据维护',
   '数据均由本人实测与修正。遇到 BUG 或数据不准，欢迎直接找我：QQ 78260590，游戏昵称「酸菜黄花鱼」。', 3),
  ('home:tips', '反角度',
   '以「目标球 → 袋口」的连线为轴，顺时针旋转到母球位置：夹角小于 180° 是正角，大于 180° 就是反角。', 0),
  ('home:tips', '蓝点补偿',
   '反角过大时，目标球碰库后的反弹角会变大，要靠控制蓝点把轨迹拉回来；正角过大同理，也需要蓝点修正。', 1),
  ('home:tips', '杆法的影响',
   '加低杆会让目标球碰库后的反弹角变大，需要适当加蓝点补偿；加高杆则相反，反弹角变小，补偿方向也要跟着反过来。', 2),
  ('home:tips', '中光圈基准',
   '资料里的「中光圈套住目标球」，指的是完全套住；如果盖不住，优先保证上边和左边完全盖住。', 3),
  ('home:tips', '数据简码',
   'C 表示蓝点横线不压不离（C10 = 离横线 10L）；U 表示竖线不压不离（U10 = 离竖线 10L）；Y 表示压竖线（Y4 = 压住竖线 4L）。', 4)
on conflict do nothing;

-- 种子数据不 bump 版本：第一次 apply 时客户端还没有 'content' 这个键，
-- 等下一次真实编辑时再 bump 即可（否则白白让所有人重下一次快照）
