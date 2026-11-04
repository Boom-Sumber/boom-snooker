# Snooker

2D 斯诺克走位教学工具（Windows 桌面端）。

- **两条主线**：彩球（122 条，按袋口 + 进袋方式筛选）、进阶（63 条）
- **内容链路**：登录后浏览 / 收藏 / 评论；投稿先进审核队列，管理员通过后才对所有人可见
- **离线可用**：本地 JSON 全量快照 + 图片缓存，断网照常看已同步的数据
- **自动更新**：应用内检查、差分下载、静默安装；首次安装仍是完整向导（可选目录、可选桌面快捷方式）

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面外壳 | Electron 44 + electron-vite |
| 渲染层 | Vue 3 + TypeScript + Element Plus + Pinia + Vue Router（hash 模式） |
| 后端 | Supabase Free（Postgres + Auth + Storage），¥0/月 |
| 本地缓存 | JSON 快照（原子 rename 替换）+ 图片文件缓存 |
| 更新 | electron-updater + electron-builder（NSIS） |

---

## 1. 快速开始

### 1.1 环境要求

| 软件 | 版本 | 说明 |
|---|---|---|
| Node.js | **22 LTS**（20 亦可） | electron-vite 要求 18+ |
| npm | 随 Node | 不要用 pnpm，Electron 的 postinstall 在软链结构下要额外配置 |
| Git | 最新 | |
| Python 3 | 仅重建数据时需要 | `pip install openpyxl pillow` |

国内网络先配镜像（`.npmrc` 已入库，直接 `npm install` 即可）：

```ini
registry=https://registry.npmmirror.com
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

```bash
npm install
cp .env.example .env.local   # 填入 Supabase 的 URL 与 publishable key（见第 2 节）
npm run dev
```

> **`TypeError: Cannot read properties of undefined (reading 'isPackaged')`**
> 不是依赖坏了，是 shell 里有 `ELECTRON_RUN_AS_NODE=1`（Electron 被当 Node 跑）。用
> `env -u ELECTRON_RUN_AS_NODE npm run dev`。详见 `docs/05` §3.1。

### 1.2 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式（窗口 + HMR） |
| `npm run build` | 类型检查（tsc + vue-tsc）后构建到 `out/` |
| `npm run typecheck` / `lint` / `lint:fix` / `format` | 质量工具 |
| `npm run build:win` | 构建 + 打 NSIS 安装包（等价于 build 后跑 electron-builder） |
| `npm run release` | 发布当前版本（见第 4 节，**不会自动构建**） |

---

## 2. 配置 Supabase

有两种处境，别混：

- **接手已有项目** → 只要两行环境变量，不用重建（2.1）
- **从零搭一套** → 按顺序走 2.2 ~ 2.5，**顺序错了会卡在"没有超管"上**

### 2.1 接手已有项目（最常见）

向项目所有者要 **Project URL** 和 **publishable key**（或 legacy anon key），写进 `.env.local`：

```ini
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_KEY=sb_publishable_...
```

两个 key 都可以公开，安全性由 RLS 保证；`service_role` **绝不要**放这里（它没有 `VITE_` 前缀，也进不了客户端）。

验证：`npm run dev` → 能进登录页 → 注册/登录后首页出现彩球列表，即通。

### 2.2 从零搭建

**① 建项目**

Dashboard → New project，region 选 **Southeast Asia (Singapore)**。建完立刻把数据库密码存进密码管理器——它不在任何文件里，丢了只能重置。

**② 关掉邮箱确认**

Authentication → Providers → Email → 关闭 `Enable email confirmations`。

> 不关的话注册要收确认邮件，免费版内置邮件服务**每小时只能发 2 封**，第三个人注册就 429。

**③ 拿到连接串**

Dashboard → Connect → **Session pooler**，形如：

```
postgresql://postgres.<ref>:<密码>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

> ⚠️ 不要用 `db.<ref>.supabase.co` 直连：它只有 IPv6 记录，本机和 GitHub Actions 都连不上。

**④ 执行迁移（001 ~ 042，分两批）**

`schema` 的唯一真相来源是 `supabase/migrations/*.sql`，按文件名顺序执行。三条路任选：

```bash
# A. psql 逐条（推荐，能精确控制批次）
export DB='postgresql://postgres.<ref>:<密码>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'

# 第一批 001~011：建表 / 触发器 / RLS / RPC / seed 数据 / Storage 桶
for n in $(seq 1 11); do
  f=$(ls supabase/migrations/$(printf %03d $n)_*.sql 2>/dev/null) || continue
  echo "→ $(basename "$f")"
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f" || break
done
```

```bash
# B. Supabase CLI（备选：先 init 生成 config.toml，再 link、push）
npx supabase init                    # 只新建 supabase/config.toml，不动 migrations
npx supabase link --project-ref <ref>
npx supabase db push                 # 按文件名顺序全部执行
```

> 走 B 会一次跑完 001~042，**跳过第 ⑤ 步的时机** → 建完两个账号后必须补跑一次 `012_roles.sql`。

```text
C. 没有 psql：Dashboard → SQL Editor，按 001、002 … 042 的顺序逐个粘贴执行
```

**⑤ 建两个引导账号（必须在 012 之前）**

`012_roles.sql` 用邮箱把两个账号提权，账号不存在就**静默跳过**，结果是系统里一个超管都没有，后面所有管理入口都进不去。

Dashboard → Authentication → Users → **Add user**（勾选 Auto Confirm），建：

| 邮箱 | 密码 | 会被 012 设成 |
|---|---|---|
| `admin@snooker.local` | 自定（自己记住） | **superadmin**（全库唯一） |
| `admin2@snooker.local` | 自定 | **admin**（内容管理员，185 条历史数据归他） |

> 此时 020（邀请码）还没执行，直接建号不会被拦。**顺序反了**就只能按 `docs/05` §5.5 的"临时邀请码"方案补。

然后继续第二批：

```bash
for n in $(seq 12 42); do
  f=$(ls supabase/migrations/$(printf %03d $n)_*.sql 2>/dev/null) || continue
  echo "→ $(basename "$f")"
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f" || break
done
```

> 若用了路线 B 已经全部推完：补建两个账号后，**单独重跑一次 `012_roles.sql`** 即可（该文件幂等）。

**⑥ 自检**

```sql
select version from dataset_meta;                                  -- 有值
select count(*) from balls;                                        -- 122
select count(*) from advanced;                                     -- 63
select id, public from storage.buckets where id in ('images','releases');  -- 两个都是 true
select role, count(*) from profiles group by role;                 -- 恰好 1 个 superadmin
```

Dashboard → **Advisors → Security** 应为无高危项（RLS 全覆盖是本项目的硬要求）。

### 2.3 数据与图片

**文案数据已在迁移里**：`008_seed_data.sql` 就是 `scripts/import_seed_data.py` 从 `text/data.xlsx` 生成的 185 行 INSERT，不需要再跑导入脚本。只有数据源更新时才重新生成：

```bash
python scripts/import_seed_data.py          # 只重写 008_seed_data.sql，人工 review 后提交
```

**图片必须单独上传**（326 张 PNG / 77 MB，转 WebP q80 后约 20 MB）：

```bash
pip install pillow
python scripts/upload_images.py --dry-run        # 先看体积，不联网写
SNOOKER_PW=<admin@snooker.local 的密码> python scripts/upload_images.py
```

脚本细节：

- 源目录**硬编码**在 `scripts/import_seed_data.py` 顶部的 `SRC`（当前 `D:\app\SnookerHelper\data`），换机器先改这里
- 只上传「表里真正引用到的」图片（326 张里有 10 张是孤儿文件，不传）
- 默认跳过已存在的对象，`--force` 才覆盖；按 `balls/<uuid>.webp`、`advanced/<uuid>.webp` 落桶
- 走管理员 JWT，受 `images` 桶的 RLS 约束（只有 admin 能写）

### 2.4 客户端是怎么拿数据的（一句话版）

启动 → 问服务端 `dataset_version` → 版本变了就下全量快照 → **原子 rename** 写到
`%APPDATA%\snooker\data-cache\dataset.json`，图片按需缓存到同级 `media/`。
所以第一次使用**必须联网一次**；之后断网只影响写操作，浏览不受影响。

### 2.5 保活与备份（Free 版必配）

Free 项目 **7 天不活跃自动暂停**，且没有任何自动备份。仓库里有两个 workflow：

| 文件 | 作用 | 频率 |
|---|---|---|
| `.github/workflows/keepalive.yml` | 打 `/auth/v1/health` 刷新活跃状态 | 每天 09:00（北京） |
| `.github/workflows/backup.yml` | `pg_dump` 全库 → artifact，保留 30 天 | 每天 09:30（北京） |

仓库 Settings → Secrets and variables → Actions 加三个：

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | 与 `.env.local` 的 `VITE_SUPABASE_KEY` 相同 |
| `SUPABASE_DB_URL` | 2.2 ③ 的 Session pooler 连接串 |

各手动 Run workflow 一次，日志里看到 `HTTP 200` / `✅ 备份包含全部关键表` 即通。

> 备份**不含 Storage 图片**。源目录 `D:\app\SnookerHelper\data` 是图片的唯一真相，别删。

---

## 3. 打包

### 3.1 版本号

```bash
npm version patch --no-git-tag-version   # 0.1.4 → 0.1.5；minor / major 同理
```

> `npm version` 经常打印 `Version not changed` 但**实际已经改了**，别被误导：
> `node -e "console.log(require('./package.json').version)"` 确认。

`--no-git-tag-version` 是必需的：tag 由发布脚本建在 GitHub 上，本地重复打会冲突。

### 3.2 构建

```bash
npm run build            # 类型检查 + 构建到 out/
npx electron-builder --win
```

`electron-builder.yml` 已写死关键项，正常不需要加参数：`oneClick: false`（带向导）、
`allowToChangeInstallationDirectory: true`、`include: build/installer.nsh`、`publish.provider: generic`。

> **本机特有绕法**：如果 electron-builder 在解包 Electron 时挂掉（`EPERM` on `moveDirAtomic`，
> 或 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` 批量删除保护），加参数跳过解包：
> `npx electron-builder --win -c.electronDist=node_modules/electron/dist`。
> 换台没装安全钩子的机器不需要。

### 3.3 产物（`dist/`，已 gitignore）

| 文件 | 体积 | 用途 |
|---|---|---|
| `snooker-<version>-setup.exe` | ~130 MB（124 MiB） | 安装包本体 |
| `snooker-<version>-setup.exe.blockmap` | ~150 KB | 差分更新的块索引，没有它每次都下全量；**必须和 exe 一起上传** |
| `latest.yml` | <1 KB | 渠道清单（版本 / sha512 / size / url），发布脚本会改写它 |

### 3.4 安装行为（首次 vs 升级）

| 场景 | 表现 |
|---|---|
| 双击安装包 | 完整向导：选安装目录 → 勾选是否创建桌面快捷方式 → 完成页 |
| 应用内升级 | **全程无窗口**（约 15 s），装完自动拉起新版本；不重建、不删除已有快捷方式 |

实现方式：`build/installer.nsh` 的 `customInit` 检查启动参数里有没有 `--updated`
（electron-updater 拉起安装器时必带，手动双击没有），命中就 `SetSilent silent` 跳过所有页面。

> 判断必须放在**安装器**里而不是客户端：`/S` 是调用方传的，而升级时跑的是**旧版本**的代码。
> 放安装器才能让"上一个版本还没改客户端"的用户第一次升级就静默。

相关细节（为什么 per-user、为什么 `--force-run` 必须为 true）见 `docs/10` §5.2.1。

---

## 4. 发版（应用内更新）

**架构一句话**：二进制进 GitHub Releases，清单（`latest.yml`）+ 策略（`policy.json`）+
版本表进 Supabase。客户端只跟 Supabase 要清单，下载才去 GitHub。

> 为什么不都放 Supabase：Free 单文件上限 **50 MB**、月出口 5 GB，而安装包 130 MB。

### 4.1 一次性准备

1. **一个公开仓库**放二进制（本项目源码与二进制同仓库 `Boom-Sumber/boom-snooker`，Releases 里只有安装包）
2. **GitHub PAT**：fine-grained，权限 **Contents: Read and write**。
   默认是 Read-only，漏改会报 `403 Resource not accessible by personal access token`，
   响应头 `x-accepted-github-permissions: contents=write` 会直接告诉你缺什么。改权限**不用换 token 值**。
3. **Supabase service_role key**：Dashboard → Project Settings → API
4. 三项都写进 `.env.local`（**不入库**）：

```ini
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GH_TOKEN=github_pat_...
GH_REPO=Boom-Sumber/boom-snooker
GH_MIRROR=https://v4.gh-proxy.org/     # 见 4.4，留空 = GitHub 直连
```

### 4.2 每次发版（五步）

```bash
npm version patch --no-git-tag-version                                  # ① 改版本号，如 0.1.4 → 0.1.5
npm run build                                                          # ② 类型检查 + 构建
npx electron-builder --win -c.electronDist=node_modules/electron/dist  # ③ 出安装包（绕法见 3.2）
node scripts/publish-release.mjs --notes "修复 XX" --min 0.1.4         # ④ 发布（--min 见 4.3）
git add -A && git commit -m "chore: release v0.1.5" && git push        # ⑤ 版本号入库
```

脚本会依次做：预检版本号 → 建/复用 `v<version>` release → 上传 exe + blockmap →
改写 `latest.yml` 的 `files[].url` 为绝对地址 → 传清单和策略到 Storage →
用 service_role 写 `app_releases` → **自检公开地址返回的版本号**。

只有最后打印 `✓ 发布完成` 才算成功。

> 第 ⑤ 步不能漏：版本号进了 `package.json` 才算发布完成的一半，否则下一个人 `git pull` 后本地版本号和线上不一致。
> 脚本本身不校验工作区，所以也可以先提交再执行第 ④ 步。

### 4.3 `--min` 的语义（最容易搞错）

`--min` = **最低可用版本**，**低于**它的客户端会被强制更新（弹窗关不掉，只能「重启安装」或「退出程序」）。

| 写法 | policy 里的值 | 效果 |
|---|---|---|
| 不传 | 本版版本号 | **所有低于本版的客户端都被强制升级** |
| `--min 0.1.4` | 0.1.4 | 只有 < 0.1.4 的强制；0.1.4 用户只在托盘看到红点，可稍后再升 |

`--min` 缺省等于"这次发布必须升"，所以**普通修复版一般要显式传上一个版本号**。

其它参数：

| 参数 | 用途 |
|---|---|
| `--notes "..."` | 写进 GitHub Release 说明和 `app_releases.notes` |
| `--manifest-only` | 只重传清单 + 策略 + 版本表，**不碰二进制**（换镜像、改最低版本时用，秒级） |
| `--dry-run` | 只打印改写后的清单，不上传、不写表 |

### 4.4 下载加速（国内必配）

GitHub Releases 国内直连实测 **23 KB/s**（130 MB 要 1.6 小时）。同一台机器同一网络实测：

| 源 | 速度 |
|---|---|
| `https://v4.gh-proxy.org/` | **8.8 MB/s**（130 MB 约 15 s） |
| `ghfast.top` | 255 KB/s |
| GitHub 直连 | 23 KB/s |

`GH_MIRROR` 只影响**清单里写的下载地址**（前缀 + GitHub 原始地址），`app_releases.installer_url`
始终记官方地址。镜像挂了不用重传安装包，换个前缀重发清单即可：

```bash
GH_MIRROR=https://另一家镜像/ node scripts/publish-release.mjs --manifest-only
```

### 4.5 验证（三处都看一眼）

```bash
# ① 公开清单（客户端真正读的东西）
curl -s https://<ref>.supabase.co/storage/v1/object/public/releases/win/latest.yml | head

# ② 策略（决定强不强制）
curl -s https://<ref>.supabase.co/storage/v1/object/public/releases/win/policy.json

# ③ 版本表
#    select version, min_supported_version, state, installer_size from app_releases order by published_at desc;
```

再装一台旧版实测：设置页 →「版本与关于」→ 检查更新 → 下载 → 重启并安装 → 版本号变化、
登录态和本地缓存都还在。

### 4.6 回滚

**不让客户端降级**。线上出问题：

```sql
update app_releases set state = 0 where version = '0.1.5';  -- 撤回，客户端看不到这一版
```

然后立刻发一个版本号更高的修复版。`latest.yml` 也要跟着重发（`--manifest-only` 前先把
`package.json` 改成新版本号并重新构建）。

---

## 5. `.env.local` 速查

```ini
# ── 客户端构建必需（VITE_ 前缀会被打进产物，这两个 key 本就设计为可公开）
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_KEY=sb_publishable_...

# ── 只有发布机需要，绝不能进客户端（无 VITE_ 前缀，不参与打包）
SUPABASE_SERVICE_ROLE_KEY=          # 写 app_releases、传 Storage
GH_TOKEN=                           # 目标仓库 contents:write
GH_REPO=Boom-Sumber/boom-snooker
GH_MIRROR=https://v4.gh-proxy.org/  # 留空 = 直连
```

`.env.local` 已在 `.gitignore`；`.env.example` 入库只放占位符。

---

## 6. 常见问题

| 现象 | 原因 / 解法 |
|---|---|
| dev 启动报 `isPackaged` undefined | shell 有 `ELECTRON_RUN_AS_NODE=1`，`env -u ELECTRON_RUN_AS_NODE npm run dev` |
| 命令行启动装好的 exe 秒退、无日志 | 同上。用户双击不受影响（变量只在命令行/IDE 会话里） |
| `npm run build` 报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` | 本机批量删除保护（单轮 >50 文件）。把 `out/` 改名而不是删 |
| 打包报 `EPERM` / 大量 copy+delete | 加 `-c.electronDist=node_modules/electron/dist`（3.2） |
| 发布报 `403 ... contents` | PAT 的 Contents 要 `Read and write`，改权限不用换 token |
| 发布报 `422 Repository is empty` | 空仓库不能建 Release，先有一次提交 |
| 更新下载只有几十 KB/s | 没配 `GH_MIRROR`，或清单还是旧地址 → 4.4 |
| 更新报 `sha512 checksum mismatch` | 差分块与缓存安装包不同步，**设计行为**：自动回退全量重下 |
| 点「重启并安装」没反应 | 若在终端里跑 dev/后台任务，进程树被一起收掉了。打包版正常 |
| `npm version` 说没变 | 实际已改，`node -e "console.log(require('./package.json').version)"` 确认 |
| `git push` 报 `CONNECT tunnel failed, response 502` | 本机 https 到 github.com 不通，`origin` 用 `ssh://git@ssh.github.com:443/...`（`AGENTS.md`） |
| 登录/注册 429 | 邮箱确认没关（2.2 ②） |
| 首页一直「正在准备本地数据」 | 看设置页同步卡片文案；日志路径在设置页「日志」行（`%APPDATA%\snooker\logs\main.log`） |

---

## 7. 目录结构

```
snooker/
├─ src/main/          Electron 主进程：窗口、主题、托盘、更新、本地存储、日志
├─ src/preload/       contextBridge 暴露 window.api
├─ src/shared/        主/渲染共用：types、api、auth、sync、storage、media
├─ src/renderer/      Vue 3 应用（注意源码在 src/renderer/src/ 这一层）
├─ supabase/migrations/   数据库 schema 唯一真相来源（001 ~ 042）
├─ scripts/           数据导入、图片上传、发版（publish-release.mjs）
├─ build/             electron-builder 资源：icon.ico、installer.nsh（**必须入库**）
├─ docs/              设计文档（见下表）
└─ resources/         运行时资源：托盘图标等
```

## 8. 文档

| 文件 | 内容 |
|---|---|
| `AGENTS.md` | AI 助手入口：铁律、提交规范、会话流程 |
| `docs/00-项目总纲.md` | 约束、技术选型、已定决策 D1–D30 |
| `docs/01-开发计划.md` | 阶段与任务清单（含每个任务的执行结果） |
| `docs/02-进度日志.md` | 逐次会话的进度记录 |
| `docs/03-数据模型与接口.md` | 表结构、RLS、RPC、调用约定 |
| `docs/04-UI设计规范.md` | 色板、组件映射、功能核对表 |
| `docs/05-环境准备.md` | 环境配置、Supabase 细节、保活备份 |
| `docs/10-应用内更新方案.md` | 更新架构、发布流程、静默安装、下载加速 |

## 授权

MIT，见 `LICENSE`。

> 安装包**没有代码签名**（¥0 的代价），首次安装 Windows SmartScreen 会提示"未知发布者"，
> 选「更多信息 → 仍要运行」。完整性由 `latest.yml` 里的 sha512 + HTTPS 保证。
