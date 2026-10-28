-- 011 · 图片路径 .jpg -> .webp
--
-- 010 只处理了 .png，但数据源里有 24 处图片名本身是 .jpg（主要是进阶系列的图）。
-- 上传脚本统一按 <uuid>.webp 存，所以表里这两类后缀都要改。
-- 教训：不要假设后缀只有一种，改后缀前先 select 一次 distinct 后缀。

update balls set impact_image = replace(impact_image, '.jpg', '.webp')
  where impact_image like '%.jpg';
update balls set blue_image = replace(blue_image, '.jpg', '.webp')
  where blue_image like '%.jpg';
update balls set route_image = replace(route_image, '.jpg', '.webp')
  where route_image like '%.jpg';

update advanced set image = replace(image, '.jpg', '.webp')
  where image like '%.jpg';

update dataset_meta set version = 1, updated_at = now() where id = 1;
