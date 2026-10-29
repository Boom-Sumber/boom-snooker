# AGENTS.md — 项目入口

> 任何新会话开始前，**先读这份文件**，再按下面的顺序读文档。  
> 这里只写"怎么开始"和"什么不能做"，具体内容在 `docs/`。

---

## 新会话开场提示词（人类复制这段发给 AI）

```
这是一个分段开发的项目，代码在 E:\Project\snooker。

开始前请按顺序做三件事，不要跳过：
1. 读 AGENTS.md（项目入口与铁律）
2. 读 docs/00-项目总纲.md（约束与已定决策，不要重新讨论选型）
3. 读 docs/01-开发计划.md 找当前任务，再读 docs/02-进度日志.md 最后一条

然后告诉我三件事：当前进度、你打算做哪个任务、第一步做什么。
在我确认之前不要写代码。
```

---

## 项目一句话

2D 斯诺克走位教学工具，**Electron + Vite + Vue3 + TypeScript + Element Plus**，仅 Windows PC。  
后端 **Supabase Free**（Postgres + Auth + Storage），本地用 JSON 缓存 + 全量快照同步。  
从旧 WPF 版（`E:\wpf\wpf\SnookerApp\Snooker_2D`）重写而来。  
**数据源**：`D:\app\SnookerHelper\data`（185 行 + 326 张图），**唯一真相，只读**。

---

## 新会话第一步（按顺序，不要跳）

```bash
# 1. 看当前进度
git log --oneline -15

# 2. 读三份文档（按顺序）
#    docs/00-项目总纲.md    约束 + 已定决策 D1–D16（读它避免重复讨论选型）
#    docs/01-开发计划.md    任务清单，找第一个 TODO / DOING
#    docs/02-进度日志.md    最后一条 = 上次会话停在哪

# 3. 确认这次做哪个任务，再动手
```

**禁止**在没读 `01-开发计划.md` 的情况下直接改代码——很容易做到一半发现这任务已经做过了。

---

## 铁律（不要推翻、不要"优化"）

1. **技术栈已定，不再讨论**：Electron + Vite + Vue3 + TS + Element Plus。理由见 `docs/00` 的决策表。
2. **成本必须 ¥0/月**。任何引入付费服务的改动都要先问。
3. **仅 Windows PC**，不做移动端、不做移动断点。
4. **UI 保留骨架、重做视觉**。布局结构、交互流程、权限驱动 UI 要 1:1 复刻；具体样式可以重来。
5. **评论必须先审后发**。`status` 只能由数据库 trigger 设为 `pending`，客户端无权指定。
6. **评论不能 bump `dataset_version`**。否则每条评论都会让所有客户端重下快照。
7. **客户端绝不出现 `service_role` key**，也不直连 Postgres 5432。
8. **`.env.local` 不入库**，`.gitignore` 里必须有它。
9. **不写死像素尺寸**（`width: 1100px` 这种）。窗口要能缩放。
10. **本地存储用原子 rename 替换**，不要直接写目标文件——中断会损坏缓存。
11. **所有 DDL 必须落成 migration 文件并提交 git**。MCP 只是执行通道，不是真相来源；`execute_sql` 只能查数据和临时验证，**禁止用来改结构**。每次 DDL 后跑 `get_advisors(type='security')`。

---

## Supabase MCP（后端操作方式）

已接入 Supabase MCP，后端操作由 AI 直接执行，不需要手动点 Dashboard。

| 场景                        | 用什么                                                        |
| ------------------------- | ---------------------------------------------------------- |
| 建表 / 改列 / 加索引 / 改策略 / 加函数 | **先写 `supabase/migrations/NNN_*.sql`，再 `apply_migration`** |
| 灌数据 / 查询 / 临时验证           | `execute_sql`                                              |
| 查表结构                      | `list_tables`                                              |
| 查迁移历史                     | `list_migrations`                                          |
| 安全自检（RLS 是否漏）             | `get_advisors(type='security')`                            |
| 生成 TS 类型                  | `generate_typescript_types`                                |
| 排查客户端 401/RLS 拒绝          | `query_logs`                                               |

**没有 MCP 工具、只能手动做的**：关闭邮箱确认（Auth 配置）、保存数据库密码。

> 项目：组织 `Boom-Projects`（`ztkscmrpkjwzjzttpmgl`），region `ap-southeast-1`。

---

## 任务与提交规范

- 任务 ID 形如 `T3.2`，在 `docs/01-开发计划.md` 有唯一编号
- **一次提交 = 一个任务**，message 格式：

```
T3.2 彩球列表页

- 6 袋口 radio + 进袋方式下拉联动
- 卡片列表复用 BallCard 组件
```

- 每个任务完成后必须做三件事（缺一不可）：
  1. 把 `01-开发计划.md` 里该任务状态改为 `DONE`
  2. 在 `02-进度日志.md` **追加**一条记录（不改历史）
  3. `git commit`

> 第 1、2 步比代码本身更重要——**新会话靠这两份文件接上手**。代码写完不更新文档，下次会话就得重新读一遍代码。

---

## 会话结束前必做

在 `docs/02-进度日志.md` 追加：

```markdown
### YYYY-MM-DD · T?.? （完成 / 未完成）
- **做了什么**：
- **改了哪些文件**：
- **遇到的坑**：
- **遗留问题**：
- **下次从哪开始**：← 最重要，写具体，比如"T3.3 表单校验规则，11 个必填项在 docs/04 第 5.5 节"
```

---

## 代码结构

| 路径                     | 说明                                            |
| ---------------------- | --------------------------------------------- |
| `src/main/`            | Electron 主进程：窗口、主题、IPC、本地文件                   |
| `src/preload/`         | 预加载脚本（contextBridge 暴露 API）                   |
| `src/shared/`          | 主/渲染共用：`types/`（已建）、api、auth、sync、storage、media（T2 建），别名 `@shared` |
| `src/renderer/`        | Vue3 应用外壳：`index.html`（含 CSP）                |
| `src/renderer/src/`    | **Vue 源码实际在这层**（electron-vite 默认结构，别名 `@renderer`）：views、components、stores、router、styles、assets |
| `build/`               | electron-builder 的 `buildResources`（图标），**必须入库**，`.gitignore` 里不能忽略 |
| `scripts/`             | 数据迁移、图片处理（阶段 0）                               |
| `supabase/migrations/` | 数据库迁移文件（**唯一的 schema 真相来源**）                  |
| `docs/`                | 本文档目录                                         |

### 常用命令

```bash
npm run dev        # 开发模式（起窗口 + HMR）
npm run build      # typecheck + 打包到 out/
npm run typecheck  # tsc + vue-tsc
npm run lint       # ESLint（--fix 用 npm run lint:fix）
```

> ⚠️ 若 `npm run dev` 报 `Cannot read properties of undefined (reading 'isPackaged')`，
> 是环境里有 `ELECTRON_RUN_AS_NODE=1`（Electron 被当成 Node 跑），用 `env -u ELECTRON_RUN_AS_NODE npm run dev`。
> 详见 `docs/05` 第 3.1 节。

---

## 参考

| 位置                                                     | 内容                       |
| ------------------------------------------------------ | ------------------------ |
| `D:\78260\Documents\workbuddy默认空间\snooker\electron重构\` | 讨论记录：为什么这么定、当时比较了什么      |
| `E:\wpf\wpf\SnookerApp\`                               | 旧 WPF 实现（**不要改**，只作对照参考） |
| `D:\app\SnookerHelper\data\`                           | **数据源（唯一真相）**：`text/data.xlsx`（ColorBalls 122 + AdvanceTable 63 = 185 行）、`img/`（326 张 PNG，77 MB）、`text/home.txt`（首页文案）。**不要改，只读** |
| `E:\wpf\wpf\SnookerApp\备份数据\`                          | 旧 MySQL dump，**已过时**（124 行 / 253 张图，2024-10 快照），**不要再当数据源用**；仅作历史对照，不要删 |
