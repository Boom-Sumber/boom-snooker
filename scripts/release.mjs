#!/usr/bin/env node
/**
 * 一条命令发版（2026-11-04 固定流程）
 *
 * 用法：
 *   node scripts/release.mjs 0.2.2                          # 最低版本默认取本版（= 强制所有旧版）
 *   node scripts/release.mjs 0.2.2 --min 0.2.1              # 普通修复版：只强制 0.2.1 以下
 *   node scripts/release.mjs 0.2.2 --notes "修了什么"        # 写进 Release 说明
 *   node scripts/release.mjs 0.2.2 --no-git                 # 不改/不提交 git（自己手动提交）
 *   node scripts/release.mjs 0.2.2 --dry-run                # 只打印将要做什么
 *
 * 做六件事（顺序不能换，每一步失败就停）：
 *   1. 改 `package.json` 的 version，改 `src/shared/version.ts` 的 MIN_SUPPORTED_VERSION
 *   2. `npm run build`（含 typecheck）
 *   3. `electron-builder --win`（带 `-c.electronDist`，绕开本机 EPERM，见 docs/05 3.2）
 *   4. `publish-release.mjs --min <min>`（上传 + 写清单/策略/版本表 + 自检）
 *   5. `git add -A && git commit && git push`（`--no-git` 可跳过；push 失败只警告，不回滚发布）
 *   6. 打印结果摘要
 *
 * ⚠️ 为什么把 MIN_SUPPORTED_VERSION 也设成 `--min`：
 *    客户端常量是"服务端策略拉不到时的兜底"。发版时让它跟本次最低版本一致，
 *    这样断网 / policy 404 的客户端也会按同一个门槛执行，不会出现"同一次发版、两种判定"。
 *    想留更宽的门槛，显式传 `--min`（比如 0.2.1），常量就跟着变成 0.2.1。
 *
 * ⚠️ 这个脚本**不碰** `docs/`、`AGENTS.md` 之外的东西：它只改版本号、构建产物和 git 提交。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = join(root, 'package.json')
const VERSION_FILE = join(root, 'src/shared/version.ts')

/* ────────────────────────── 参数 ────────────────────────── */

function parseArgs(argv) {
  const args = { version: '', min: '', notes: '', git: true, dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item === '--min') args.min = argv[++i] ?? ''
    else if (item === '--notes') args.notes = argv[++i] ?? ''
    else if (item === '--no-git') args.git = false
    else if (item === '--dry-run') args.dryRun = true
    else if (item.startsWith('-')) fail(`不认识的参数：${item}`)
    else if (!args.version) args.version = item
    else fail(`多余的参数：${item}`)
  }
  if (!args.version) fail('缺少版本号。用法：node scripts/release.mjs 0.2.2 [--min 0.2.1]')
  if (!/^\d+\.\d+\.\d+$/.test(args.version)) fail(`版本号必须是 x.y.z：${args.version}`)
  if (args.min && !/^\d+\.\d+\.\d+$/.test(args.min)) fail(`--min 必须是 x.y.z：${args.min}`)
  args.min = args.min || args.version
  return args
}

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

/** 与 `@shared/version` 同一套比较规则（这里不 import，避免 ts 运行时的麻烦） */
function compareVersion(a, b) {
  const left = a.replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0)
  const right = b.replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function run(command, args, label) {
  console.log(`\n▶ ${label}`)
  console.log(`  ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
}

/* ────────────────────────── 主流程 ────────────────────────── */

const args = parseArgs(process.argv.slice(2))
const pkg = JSON.parse(readFileSync(PKG, 'utf8'))
const current = pkg.version

if (compareVersion(args.version, current) < 0) {
  fail(`新版本 ${args.version} 低于当前 ${current}，不做降级（回滚请发更高的版本号）`)
}
if (compareVersion(args.min, args.version) > 0) {
  fail(`--min ${args.min} 高于本次版本 ${args.version}：线上将没有任何合规版本，客户端会被锁死`)
}

console.log('\n════════ 发版计划 ════════')
console.log(`  当前版本      ${current}`)
console.log(`  发布版本      ${args.version}`)
console.log(`  最低可用版本  ${args.min}${args.min === args.version ? '（等于本版：所有旧版强制升级）' : ''}`)
console.log(`  客户端兜底    MIN_SUPPORTED_VERSION → ${args.min}`)
console.log(`  说明          ${args.notes || '(空)'}`)
console.log(`  git 提交      ${args.git ? '是' : '否（--no-git）'}`)
console.log('══════════════════════════\n')

if (args.dryRun) {
  console.log('--dry-run：只打印，不执行。')
  process.exit(0)
}

// 1. 版本号 + 客户端兜底常量
console.log('▶ 写版本号')
const nextPkg = { ...pkg, version: args.version }
writeFileSync(PKG, `${JSON.stringify(nextPkg, null, 2)}\n`)

const versionSource = readFileSync(VERSION_FILE, 'utf8')
const MIN_PATTERN = /export const MIN_SUPPORTED_VERSION = '[^']*'/
if (!MIN_PATTERN.test(versionSource)) fail('没在 src/shared/version.ts 里找到 MIN_SUPPORTED_VERSION，停止')

const patched = versionSource.replace(MIN_PATTERN, `export const MIN_SUPPORTED_VERSION = '${args.min}'`)
// 值本来就等于目标时不写（否则 replace 结果与原文相同，会被误判成"没找到"）
if (patched !== versionSource) writeFileSync(VERSION_FILE, patched)
console.log(`  package.json → ${args.version}｜MIN_SUPPORTED_VERSION → ${args.min}`)

// 2. 构建（含 typecheck）
run('npm', ['run', 'build'], '构建（typecheck + electron-vite build）')

// 3. 打安装包
run(
  'npx',
  ['electron-builder', '--win', '-c.electronDist=node_modules/electron/dist'],
  '打 Windows 安装包'
)

// 4. 发布（上传 + 清单 + 策略 + 版本表 + 自检）
const publishArgs = ['scripts/publish-release.mjs', '--min', args.min]
if (args.notes) publishArgs.push('--notes', args.notes)
run('node', publishArgs, '发布到 GitHub Releases + Supabase')

// 5. git 提交与推送
if (args.git) {
  console.log('\n▶ 提交并推送')
  try {
    execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'inherit' })
    execFileSync('git', ['commit', '-m', `chore: release v${args.version}`], {
      cwd: root,
      stdio: 'inherit'
    })
  } catch {
    console.log('  （没有可提交的改动，跳过 commit）')
  }

  try {
    execFileSync('git', ['push'], { cwd: root, stdio: 'inherit' })
    console.log('  ✓ 已推送')
  } catch {
    // 推送失败不影响已经发出去的版本，记录一笔让下次会话先补推
    console.warn(`  ⚠️ git push 失败（网络/代理常见）。版本已发布，记得下次先 \`git push\``)
  }
} else {
  console.log('\n（--no-git：请自己提交 `chore: release v' + args.version + '`）')
}

console.log('\n════════ 完成 ════════')
console.log(`  v${args.version} 已发布，最低可用版本 ${args.min}`)
console.log('  装一次确认：启动 3 s 内应出现强制更新（若 min > 已装版本）')
console.log('══════════════════════\n')
