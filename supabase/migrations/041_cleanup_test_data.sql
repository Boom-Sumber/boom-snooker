-- ============================================================
-- 041 · 上线前数据清洗（D37 / T11.2）
--
-- 背景：开发期为了验证权限、审核、通知、超时升级，在库里留了大量测试数据：
--   7 个测试账号、8 条 `method` 全是"测试…"的彩球、1 条「评论测试」、12 条通知，
--   以及这些记录自带的 24 张图片。上线前必须清干净，否则：
--     ① 列表里会出现「测试超时升级」这类记录
--     ② 账户管理页出现 7 个假账号
--     ③ 快照里带测试图，白占流量与本地缓存
--
-- **保留**：2 个账号（admin@snooker.local 超管 + 78260590@qq.com 管理员）
--          与它们名下的原始数据（balls 122 + advanced 63，与旧 WPF 源逐项一致）
--
-- 为什么顺序是这样（查 pg_constraint 得到的结论，别改顺序）：
--   profiles.id  → auth.users : CASCADE   （删账号会带走 profiles）
--   balls.owner_id   → auth.users : SET NULL   （先删账号会留下 owner_id=null 的孤儿）
--   advanced.owner_id→ auth.users : SET NULL
--   comments.user_id → auth.users : NO ACTION  （不先删评论，删账号会被外键拦住）
--   notifications.user_id → auth.users : CASCADE
--   所以：通知 → 评论 → 记录 → 账号 → 孤儿图 → bump 版本
--
-- 孤儿图为什么**不在这条 migration 里**：Supabase 的 `storage.protect_delete()`
-- 会拒绝任何 SQL 直删（`ERROR 42501: Direct deletion from storage tables is not
-- allowed. Use the Storage API instead.`）—— 这是平台故意的保护。
-- 所以图片清理走应用内「回收站 → 孤儿图片 → 删除选中」（T7.3 的既有流程，超管专用）。
-- 记录删完之后那 24 个对象就变成孤儿了，在界面上点一次即可，并会写审计。
--
-- 回滚：**数据删除不可真正回滚**。备份在
-- `.workbuddy-ai/backup/2026-11-03-before-cleanup.json`（不入库）；
-- 原始 122 + 63 条根本没动，真出问题可从数据源
-- `D:\app\SnookerHelper\data` 用 `scripts/import_seed_data.py` 重灌。
-- 账号无法完整恢复（Auth 的密码哈希不在备份里），只能重新注册。
-- 清单与期望值见 `docs/09-数据清洗清单.md`。
-- ============================================================

do $$
declare
  -- 保留的两个账号：超管 / 管理员（原始数据的 owner）
  keep        uuid[] := array[
    'c2df4712-36e8-4a80-a408-17b80d4a95cd'::uuid,  -- admin@snooker.local   superadmin
    '0e9d84e6-d737-42ff-bb04-6894c1ad24e9'::uuid   -- 78260590@qq.com       admin
  ];
  -- 7 个测试账号
  test_users  uuid[] := array[
    '947bf75b-91c1-4c61-942c-25f6411ae3c9'::uuid,  -- test-viewer@snooker.local
    'f363c1c9-921c-44d0-94e6-c3d4da25d4b3'::uuid,  -- rest@qq.com
    'b574de83-a660-41a6-8078-d9fca4b2f146'::uuid,  -- yyyyy@163.com
    '9265b856-f5e3-4c0c-85d2-0f4a5692c6a6'::uuid,  -- test@aa.com
    'b4dfc92c-bc4d-4dc2-85d2-4db9dbac38c6'::uuid,  -- test1@snooker.local
    '9f64ed50-aaf4-4e77-ac48-769b9fd417db'::uuid,  -- test2@snooker.local
    '22b05e97-5b6e-467c-b9b8-f6622749b9eb'::uuid   -- test3@snooker.local
  ];
  n_balls     int;
  n_adv       int;
  n_comments  int;
  n_notif     int;
begin
  -- ① 通知：12 条全是测试活动产物（含给超管的 1 条超时升级），全删
  select count(*) into n_notif from notifications;
  delete from notifications;

  -- ② 评论：只删测试作者写的（库里 1 条「评论测试」）
  select count(*) into n_comments from comments where user_id = any (test_users);
  delete from comments where user_id = any (test_users);

  -- ③ 记录：owner 不在保留名单里的（8 条测试彩球；进阶本来就是 0）
  select count(*) into n_balls from balls
   where owner_id is not null and owner_id <> all (keep);
  delete from balls
   where owner_id is not null and owner_id <> all (keep);

  select count(*) into n_adv from advanced
   where owner_id is not null and owner_id <> all (keep);
  delete from advanced
   where owner_id is not null and owner_id <> all (keep);

  -- ④ 账号：profiles / invite_codes 靠外键 CASCADE 一起走
  delete from auth.users where id = any (test_users);

  -- ⑤ 孤儿图不在 SQL 里删（见文件头说明）：走应用内「回收站 → 孤儿图片」

  -- 审计：把"删了什么"记进 admin_actions（actor 记超管）
  insert into admin_actions (actor_id, action, target_id, detail)
  values (
    keep[1],
    'cleanup_test_data',
    null,
    jsonb_build_object(
      'balls', n_balls,
      'advanced', n_adv,
      'comments', n_comments,
      'notifications', n_notif,
      'users', array_length(test_users, 1),
      'note', 'T11.2 上线前清洗（D37）；备份见 .workbuddy-ai/backup/2026-11-03-before-cleanup.json；图片走应用内孤儿图清理'
    )
  );

  raise notice '清洗完成：balls=% advanced=% comments=% notifications=% users=%',
    n_balls, n_adv, n_comments, n_notif, array_length(test_users, 1);
end $$;

-- ⑥ 版本 +1：让所有客户端下次启动重下快照（删记录本身也可能已触发 bump，多一次无害）
update dataset_meta set version = version + 1, updated_at = now() where id = 1;
