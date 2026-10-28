-- 001 · 表结构 + 索引 + 基础字典
-- 依据 docs/03-数据模型与接口.md 第 1 节
-- 全部 if not exists，可重复执行

-- ─────────────────────────────────────────────
-- 1.1 用户资料
-- ─────────────────────────────────────────────
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nickname    text not null,
  avatar      text,
  role        text not null default 'viewer' check (role in ('admin','viewer')),
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 1.2 彩球打法（参考数据）
-- ─────────────────────────────────────────────
create table if not exists balls (
  id            uuid primary key default gen_random_uuid(),
  color_code    text not null,          -- yellow/green/brown/blue/pink/black
  pocket_code   text not null,          -- top_left / bottom_left / top_middle / ...
  method        text not null,          -- 进袋方式（自由文本：直线、半台一库翻袋…）
  strength_code text not null,          -- full / half / ...
  sight         text not null,          -- 瞄准方法
  low_comp      text not null,          -- 低杆走位补偿
  high_comp     text not null,          -- 高杆走位补偿
  remark        text,                   -- 补充说明
  impact_image  text not null,          -- Storage object path
  blue_image    text not null,
  route_image   text not null,
  state         int  not null default 1,
  updated_at    timestamptz not null default now(),
  updated_by    text                    -- 昵称，冗余存储避免 join
);

create index if not exists idx_balls_query
  on balls (color_code, pocket_code, method) where state = 1;

-- ─────────────────────────────────────────────
-- 1.3 进阶系列（参考数据）
-- ─────────────────────────────────────────────
create table if not exists advanced (
  id            uuid primary key default gen_random_uuid(),
  category_code text not null,          -- straight / kick / curve / break / other
  title         text not null,
  description   text,
  content       text,
  image         text not null,
  state         int not null default 1,
  updated_at    timestamptz not null default now(),
  updated_by    text
);

create index if not exists idx_advanced_query
  on advanced (category_code) where state = 1;

-- ─────────────────────────────────────────────
-- 1.4 显示字典（随快照下发）
-- ─────────────────────────────────────────────
create table if not exists display_dict (
  kind    text not null,               -- color / pocket / strength / category / role
  code    text not null,
  name_zh text not null,
  sort    int  not null default 0,
  primary key (kind, code)
);

insert into display_dict (kind, code, name_zh, sort) values
  ('color','yellow','黄球',1), ('color','green','绿球',2), ('color','brown','咖啡球',3),
  ('color','blue','蓝球',4),  ('color','pink','粉球',5),  ('color','black','黑球',6),

  ('pocket','top_left','左上袋',1),   ('pocket','bottom_left','左下袋',2),
  ('pocket','top_middle','上中袋',3), ('pocket','bottom_middle','下中袋',4),
  ('pocket','top_right','右上袋',5),  ('pocket','bottom_right','右下袋',6),

  ('category','straight','直线系列',1), ('category','kick','翻袋系列',2),
  ('category','curve','弧线系列',3),    ('category','break','破局系列',4),
  ('category','other','其他系列',5),

  ('strength','full','满力',1), ('strength','half','半力（小力）',2),

  ('role','admin','管理员',1), ('role','viewer','普通用户',2)
on conflict (kind, code) do update
  set name_zh = excluded.name_zh, sort = excluded.sort;

-- ─────────────────────────────────────────────
-- 1.5 数据集版本
-- ─────────────────────────────────────────────
create table if not exists dataset_meta (
  id         int primary key default 1 check (id = 1),
  version    int not null default 1,
  updated_at timestamptz not null default now()
);

insert into dataset_meta (id, version) values (1, 1) on conflict (id) do nothing;

-- ─────────────────────────────────────────────
-- 1.6 评论
-- ─────────────────────────────────────────────
create table if not exists comments (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('ball','advanced')),
  target_id   uuid not null,
  user_id     uuid not null references auth.users(id),
  content     text not null check (char_length(content) between 1 and 300),
  status      text not null default 'pending'
              check (status in ('pending','visible','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists idx_comments_public on comments (target_type, target_id, created_at desc)
  where deleted_at is null and status = 'visible';
create index if not exists idx_comments_pending on comments (created_at desc) where status = 'pending';
create index if not exists idx_comments_mine on comments (user_id, created_at desc);
