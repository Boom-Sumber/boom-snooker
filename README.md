# Snooker

2D 斯诺克走位教学工具（Windows 桌面端）。

## 技术栈

- **桌面**：Electron + electron-vite
- **前端**：Vue 3 + TypeScript + Element Plus + Pinia + Vue Router
- **后端**：Supabase（Postgres + Auth + Storage）
- **本地缓存**：JSON 文件 + 内存查询

## 快速开始

```bash
# 1. 配置镜像（首次）
#    .npmrc 已包含国内镜像配置，直接 npm install 即可

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env.local
#    填入 Supabase 的 Project URL 与 anon key

# 4. 开发模式
npm run dev
```

> 如果 `npm run dev` 报 `Cannot read properties of undefined (reading 'isPackaged')`，
> 说明 shell 里有 `ELECTRON_RUN_AS_NODE=1`，用 `env -u ELECTRON_RUN_AS_NODE npm run dev`（见 `docs/05` 第 3.1 节）。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式（窗口 + HMR） |
| `npm run build` | 类型检查 + 构建到 `out/` |
| `npm run typecheck` | `tsc` + `vue-tsc` |
| `npm run lint` / `lint:fix` | ESLint 检查 / 自动修复 |
| `npm run format` | Prettier 格式化（不碰 `docs/` 与 SQL） |
| `npm run build:win` | 打 Windows 安装包（T6.3 完善） |

## 文档

| 文件 | 内容 |
|---|---|
| `AGENTS.md` | AI 助手入口：铁律、提交规范、会话流程 |
| `docs/00-项目总纲.md` | 约束、技术选型、已定决策 |
| `docs/01-开发计划.md` | 阶段与任务清单（含进度） |
| `docs/02-进度日志.md` | 逐次会话的进度记录 |
| `docs/03-数据模型与接口.md` | 表结构、RLS、RPC、调用约定 |
| `docs/04-UI设计规范.md` | 色板、组件映射、功能核对表 |
| `docs/05-环境准备.md` | 环境配置、脚手架注意事项 |

## 说明

本项目是旧 WPF 版本的重写：
- 旧实现：`E:\wpf\wpf\SnookerApp\Snooker_2D`（仅作对照参考，不再维护）
- **数据源**：`D:\app\SnookerHelper\data\`（`text/data.xlsx` 185 行 + `img/` 326 张图 + `text/home.txt` 首页文案，**唯一真相，只读**）
- 旧 MySQL dump：`E:\wpf\wpf\SnookerApp\备份数据\`（2024-10 快照，**已过时**，仅留作历史对照）

成本目标：**¥0 / 月**（Supabase 免费额度 + 内部小圈子使用）。
