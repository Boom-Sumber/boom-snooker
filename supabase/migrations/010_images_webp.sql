-- 010 · 图片路径 .png -> .webp
--
-- T0.4 把 316 张被引用的 PNG 转成 WebP(q80) 后上传到 images bucket
-- （70.5 MB -> 6.7 MB，9.5%），表里的 object path 要跟着改后缀。
-- 空字符串（2 条「正在测试」记录）不匹配 '%.png'，天然不受影响。

update balls set impact_image = replace(impact_image, '.png', '.webp')
  where impact_image like '%.png';
update balls set blue_image = replace(blue_image, '.png', '.webp')
  where blue_image like '%.png';
update balls set route_image = replace(route_image, '.png', '.webp')
  where route_image like '%.png';

update advanced set image = replace(image, '.png', '.webp')
  where image like '%.png';

-- 以上 update 会触发 bump_dataset_version，这里复位成初始版本
update dataset_meta set version = 1, updated_at = now() where id = 1;
