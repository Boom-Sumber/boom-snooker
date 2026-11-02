-- ============================================================
-- 029 · 修正 028 的记录审核触发器（T4.7 补丁）
--
-- 问题
--   028 里 `notify_record_review()` 用简单 CASE 取标签：
--     case tg_table_name
--       when 'balls' then ... new.method ...
--       else ... new.title ...
--     end
--   plpgsql 在准备这条赋值语句时会把**两个分支的字段引用一起解析**，
--   而 `balls` 没有 `title` 列 → 审核彩球时直接报
--     ERROR 42703: record "new" has no field "title"
--   结果：记录审核（通过/驳回）整体失败，前端只看到一句英文报错。
--
-- 修法
--   拆成 IF / ELSE 两条独立语句 —— plpgsql 的语句是**首次执行时才准备**的，
--   走不到的分支不会被解析，也就不会碰不存在的列。
--
-- 教训（值得记住）
--   共用一个触发器函数处理两张结构不同的表时，**不要用 CASE 选字段**；
--   IF 分支是安全的，CASE 不是。
--
-- 回滚：无（替换函数体，旧版本见 028）
-- ============================================================

create or replace function notify_record_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_type  text;
  v_label text;
begin
  -- 只处理「pending → visible / rejected」这一次状态迁移
  if old.review_status = new.review_status then return new; end if;
  if old.review_status <> 'pending' then return new; end if;
  if new.owner_id is null then return new; end if;

  -- 关键：分表取字段必须用 IF 分支，不能放进 CASE（见文件头）
  if tg_table_name = 'balls' then
    v_type  := 'ball';
    v_label := coalesce(nullif(btrim(new.method), ''), '这条打法');
  else
    v_type  := 'advanced';
    v_label := coalesce(nullif(btrim(new.title), ''), '这条进阶');
  end if;

  insert into notifications (user_id, kind, title, body, target_type, target_id)
  values (
    new.owner_id,
    case new.review_status when 'visible' then 'record_visible' else 'record_rejected' end,
    case new.review_status
      when 'visible' then '你投稿的记录已通过审核'
      else '你投稿的记录未通过审核'
    end,
    case
      when new.review_status = 'visible' then v_label
      else coalesce(nullif(btrim(coalesce(new.review_note, '')), ''), '管理员没有填写原因')
    end,
    v_type,
    new.id
  );
  return new;
end $$;
