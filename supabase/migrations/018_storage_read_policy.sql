-- 018 · Storage 读策略：让 authenticated 能"看见"对象行
--
-- 现象（T3.3 实测踩到）：
--   前端 `storage.from('images').remove([...])` 返回 `[]`（成功、无 error），
--   但文件一个都没删掉，`storage.objects` 里还在。
--
-- 原因：
--   bucket `images` 是 public，读走 `/storage/v1/object/public/...`，**不经过 RLS**，
--   所以 009 从来没给 storage.objects 建过 SELECT 策略。
--   但 **DELETE 操作需要先按 RLS 找到目标行** —— 没有 SELECT 策略 ⇒ 查到 0 行
--   ⇒ 删 0 行 ⇒ 仍然返回成功。表现为"静默失败"，比报错更难查。
--
-- 影响：
--   表单保存失败时的图片回滚（`removeUploadedImages`）等于没执行，
--   每失败一次就留 3 张没人引用的 WebP 在桶里。
--
-- 代价：
--   登录用户可以 `list()` 出桶里的文件名（内容本来就是公开的，只是多了"能列举"）。
--   内部圈子工具可接受；不放开这条，客户端就没法清理自己刚传的文件。
--
-- 注意：不要给 anon 开这条 —— 未登录不需要删除，公开读走 CDN 不受影响。

drop policy if exists images_read on storage.objects;
create policy images_read on storage.objects for select to authenticated
  using (bucket_id = 'images');
