#!/usr/bin/env node
/**
 * 发布一个桌面端版本（U1）
 *
 * 为什么二进制不放 Supabase：安装包 132 MB，Free 单文件上限 50 MB、月出口 5 GB。
 * 所以拆成两半 —— 二进制进 GitHub 公开 Releases，清单（latest.yml，几百字节）进
 * Supabase Storage，客户端只跟 Supabase 要清单，下载才去 GitHub。
 * 设计见 docs/10-应用内更新方案.md。
 *
 * 用法：
 *   npm run build:win             # 先出包（脚本不负责构建，避免误发）
 *   node scripts/publish-release.mjs --notes "修复 XX" [--min 0.1.0] [--dry-run]
 *
 * 需要的环境变量（写在 .env.local，不入库）：
 *   SUPABASE_SERVICE_ROLE_KEY  发布机专用，**绝不能进客户端**
 *   GH_TOKEN                   只需目标仓库的 contents:write
 *   GH_REPO                    owner/repo，默认 Boom-Sumber/boom-snooker（源码已开源，直接用主仓库 Releases）
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { request } from 'node:https'
import { lookup } from 'node:dns'
import { Resolver } from 'node:dns/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 解析域名，系统 DNS 失败时回退公共 DNS。
 * 本机网关对 uploads.github.com 会超时（`getaddrinfo ENOTFOUND`），
 * 但 223.5.5.5 / 8.8.8.8 都能正常给出 IP，IP 本身也是通的。
 */
const DNS_FALLBACK = ['223.5.5.5', '8.8.8.8', '1.1.1.1']
async function resolveHost(hostname) {
  const sys = await new Promise((r) => lookup(hostname, { all: true }, (e, a) => r(e ? [] : a)))
  if (sys.length) return sys[0].address
  for (const server of DNS_FALLBACK) {
    try {
      const resolver = new Resolver({ timeout: 4000, tries: 2 })
      resolver.setServers([server])
      const list = await resolver.resolve4(hostname)
      if (list.length) {
        console.log(`  系统 DNS 解析失败，已用 ${server} 解析 ${hostname} → ${list[0]}`)
        return list[0]
      }
    } catch {
      /* 换下一个 DNS */
    }
  }
  throw new Error(`无法解析 ${hostname}（系统 DNS 与公共 DNS 均失败）`)
}

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIST = join(ROOT, 'dist')

/** 读 .env.local（项目里没有 dotenv，手写 6 行够用；不要读 .env.example） */
function loadEnv() {
  const file = join(ROOT, '.env.local')
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m || line.trimStart().startsWith('#')) continue
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return out
}

const env = { ...loadEnv(), ...process.env }
const SUPABASE_URL = (env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || ''
const GH_TOKEN = env.GH_TOKEN || ''
const GH_REPO = env.GH_REPO || 'Boom-Sumber/boom-snooker'
const BUCKET = 'releases'
/** 清单在桶里的固定位置；客户端的 app-update.yml 指向它，不能按版本变 */
const MANIFEST_PATH = 'win/latest.yml'
/** 更新策略（最低可用版本），与清单同目录，客户端按 feed 地址拼出来 */
const POLICY_PATH = 'win/policy.json'

/**
 * 下载加速前缀（2026-11-03 实测后加的）
 *
 * 二进制在 GitHub，但国内直连 **23 KB/s**（130 MB 要 1.6 小时）。同一个包走
 * `v4.gh-proxy.org` 实测 **8.8 MB/s、15 秒下完**，所以清单里的 url 写成
 * `<前缀><GitHub 原始地址>`。GitHub 页面上的官方附件地址不变，只是客户端从这里取。
 *
 * 改法：`.env.local` 里 `GH_MIRROR=https://xxx/`（留空 = 用 GitHub 直连）。
 * 代理挂了不要紧 —— 重新发一次清单即可（`--manifest-only`，秒级，不用重传安装包）。
 */
const MIRROR = (env.GH_MIRROR ?? 'https://v4.gh-proxy.org/').trim()
const mirrorPrefix = MIRROR ? MIRROR.replace(/\/*$/, '/') : ''

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const notes = value('notes', '')
const minSupported = value('min', '')
const dryRun = flag('dry-run')
/** 只重发清单 + 策略 + 版本表，不上传二进制（换镜像 / 改最低版本时用） */
const manifestOnly = flag('manifest-only')

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

function step(text) {
  console.log(`\n▶ ${text}`)
}

/** GitHub API：小 JSON 请求用 fetch 足够（上传二进制另走 node:https，见 uploadAsset） */
async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'snooker-release-script',
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    // 不能在这里 fail()：调用方要靠 404 判断"release 还没建"，直接退出会把流程杀掉
    const err = new Error(`GitHub ${init.method || 'GET'} ${path} → ${res.status}\n${text.slice(0, 500)}`)
    err.status = res.status
    throw err
  }
  return body
}

/**
 * 上传 release 资产。
 * 不用 fetch：undici 的 headersTimeout 默认 300 s，从请求发出就开始计时，
 * 132 MB 在慢链路上会被硬掐断。node:https + 流式 pipe 没有这个限制。
 */
async function uploadAsset(releaseId, name, filePath) {
  const size = statSync(filePath).size
  const host = 'uploads.github.com'
  const ip = await resolveHost(host)
  return new Promise((resolvePromise, reject) => {
    const req = request(
      {
        host: ip,
        servername: host, // TLS SNI 仍按域名，证书校验不受影响
        path: `/repos/${GH_REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
        method: 'POST',
        headers: {
          Host: host,
          Authorization: `Bearer ${GH_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'snooker-release-script',
          'Content-Type': 'application/octet-stream',
          'Content-Length': size
        }
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolvePromise(JSON.parse(body))
          else reject(new Error(`上传 ${name} 失败 ${res.statusCode}: ${body.slice(0, 300)}`))
        })
      }
    )
    req.on('error', reject)
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.pipe(req)
  })
}

/** 幂等：同名资产先删再传，避免"已存在"报错卡住重发 */
async function ensureAsset(releaseId, name, filePath) {
  const assets = await gh(`/repos/${GH_REPO}/releases/${releaseId}/assets?per_page=100`)
  const existing = assets.find((a) => a.name === name)
  if (existing) {
    console.log(`  删除同名旧资产 ${name}（${existing.size} B）`)
    await gh(`/repos/${GH_REPO}/releases/assets/${existing.id}`, { method: 'DELETE' })
  }
  const size = statSync(filePath).size
  console.log(`  上传 ${name}（${(size / 1024 / 1024).toFixed(1)} MB）…`)
  const started = Date.now()
  await uploadAsset(releaseId, name, filePath)
  console.log(`  完成，用时 ${((Date.now() - started) / 1000).toFixed(1)} s`)
}

/**
 * 改写 latest.yml：只动 url / path 两处，sha512、size、releaseDate 原样保留。
 * 不做 YAML 解析 —— 结构由 electron-builder 生成且极稳定，按行替换更不容易出错。
 */
function rewriteManifest(raw, absoluteUrl) {
  const lines = raw.split(/\r?\n/)
  const out = lines.map((line) => {
    if (/^\s*-?\s*url:\s*\S+\s*$/.test(line)) {
      return line.replace(/url:\s*\S+\s*$/, `url: ${absoluteUrl}`)
    }
    if (/^path:\s*\S+\s*$/.test(line)) {
      return `path: ${absoluteUrl}`
    }
    return line
  })
  return out.join('\n')
}

async function supabaseFetch(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(init.headers || {})
    }
  })
  const text = await res.text()
  if (!res.ok) fail(`Supabase ${init.method || 'GET'} ${path} → ${res.status}\n${text.slice(0, 500)}`)
  return text
}

async function main() {
  step('预检')
  if (!existsSync(join(ROOT, 'package.json'))) fail('找不到 package.json，脚本要在项目根目录跑')
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const version = pkg.version
  const tag = `v${version}`

  if (!dryRun) {
    if (!SUPABASE_URL) fail('.env.local 缺 VITE_SUPABASE_URL')
    if (!SERVICE_KEY) fail('.env.local 缺 SUPABASE_SERVICE_ROLE_KEY（发布要写版本表 + 传清单）')
    if (!GH_TOKEN) fail('.env.local 缺 GH_TOKEN（需要目标仓库的 contents:write）')
    if (!GH_REPO.includes('/')) fail(`GH_REPO 应形如 owner/repo，当前是 "${GH_REPO}"`)
  }

  const exeName = `${pkg.name}-${version}-setup.exe`
  const exePath = join(DIST, exeName)
  const blockmapPath = `${exePath}.blockmap`
  const manifestPath = join(DIST, 'latest.yml')
  for (const f of [exePath, blockmapPath, manifestPath]) {
    if (!existsSync(f)) fail(`缺少产物 ${f}\n  先跑 npm run build:win，并且 package.json 的 version 要与产物一致`)
  }
  const exeSize = statSync(exePath).size
  console.log(`  版本 ${version} · 安装包 ${(exeSize / 1024 / 1024).toFixed(1)} MB · 仓库 ${GH_REPO}`)

  step(`创建 / 复用 release ${tag}`)
  let release = null
  if (dryRun) {
    console.log('  dry-run：跳过 GitHub 与 Supabase')
  } else if (manifestOnly) {
    // 只改清单（比如换下载镜像）：安装包已经在 release 上了，重传 130 MB 没意义
    console.log('  --manifest-only：跳过 release 与附件上传')
  } else {
    try {
      release = await gh(`/repos/${GH_REPO}/releases/tags/${tag}`)
      console.log(`  release 已存在（id=${release.id}），复用`)
    } catch (err) {
      if (err.status !== 404) throw err
      release = await gh(`/repos/${GH_REPO}/releases`, {
        method: 'POST',
        body: JSON.stringify({
          tag_name: tag,
          name: tag,
          body: notes || `Snooker ${version}`,
          draft: false,
          prerelease: false
        })
      })
      console.log(`  已创建 release id=${release.id}`)
    }

    step('上传二进制到 GitHub')
    await ensureAsset(release.id, exeName, exePath)
    await ensureAsset(release.id, `${exeName}.blockmap`, blockmapPath)
  }

  /** GitHub 上的官方地址（写进 release 页面，也是清单里的原始地址） */
  const officialUrl = `https://github.com/${GH_REPO}/releases/download/${tag}/${exeName}`
  /** 客户端真正去下的地址：拼上加速前缀（没配前缀时就是官方地址） */
  const installerUrl = mirrorPrefix ? `${mirrorPrefix}${officialUrl}` : officialUrl
  const blockmapUrl = `${installerUrl}.blockmap`

  step('改写清单并传到 Storage')
  const rawManifest = readFileSync(manifestPath, 'utf8')
  const manifest = rewriteManifest(rawManifest, installerUrl)
  if (!manifest.includes(installerUrl)) fail('清单改写失败：没找到可替换的 url 行')
  // 防御：清单里的 size 必须和实际文件一致，否则客户端会下到一半校验失败
  const sizeInManifest = Number(/size:\s*(\d+)/.exec(rawManifest)?.[1] || 0)
  if (sizeInManifest && sizeInManifest !== exeSize) {
    fail(`清单 size(${sizeInManifest}) 与实际文件(${exeSize}) 不符，产物可能不是同一次构建`)
  }
  if (dryRun) {
    console.log(manifest)
    step('dry-run 结束（未上传）')
    return
  }
  await supabaseFetch(`/storage/v1/object/${BUCKET}/${MANIFEST_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/yaml',
      'Cache-Control': 'no-cache',
      'x-upsert': 'true'
    },
    body: manifest
  })
  console.log(`  已上传 ${BUCKET}/${MANIFEST_PATH}`)

  // policy.json：清单只描述"有什么版本"，最低可用版本是**策略**，单独放一个文件。
  // 客户端拿不到它时按"不强制"处理（见 src/main/updater.ts 的 fetchMinSupportedVersion）。
  step('上传更新策略 policy.json')
  const policy = JSON.stringify(
    {
      version,
      min_supported_version: minSupported || version,
      published_at: new Date().toISOString()
    },
    null,
    2
  )
  await supabaseFetch(`/storage/v1/object/${BUCKET}/${POLICY_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'x-upsert': 'true'
    },
    body: policy
  })
  console.log(`  已上传 ${BUCKET}/${POLICY_PATH}`)

  step('写版本表')
  const sha512 = /sha512:\s*(\S+)/.exec(rawManifest)?.[1] || ''
  if (!sha512) fail('清单里没有 sha512，拒绝写表')
  await supabaseFetch(`/rest/v1/app_releases?on_conflict=version`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify({
      version,
      channel: 'stable',
      min_supported_version: minSupported || null,
      notes: notes || null,
      // 表里记 GitHub 官方地址（长期有效）；镜像只体现在清单里，随时可换
      installer_url: officialUrl,
      installer_size: exeSize,
      sha512,
      blockmap_url: blockmapUrl,
      state: 1
    })
  })
  console.log(`  已写入 app_releases: ${version}`)

  step('自检')
  const publicManifest = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${MANIFEST_PATH}`
  const res = await fetch(publicManifest)
  const text = await res.text()
  const seen = /version:\s*(\S+)/.exec(text)?.[1]
  console.log(`  ${res.status} ${publicManifest}`)
  if (seen !== version) fail(`公开清单里的版本是 "${seen}"，期望 "${version}"`)
  console.log(`  ✓ 公开清单已是 ${version}`)

  const publicPolicy = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${POLICY_PATH}`
  const policyRes = await fetch(publicPolicy)
  const policyText = await policyRes.text()
  const minSeen = /"min_supported_version"\s*:\s*"([^"]+)"/.exec(policyText)?.[1]
  console.log(`  ${policyRes.status} ${publicPolicy}`)
  if (minSeen !== (minSupported || version)) {
    fail(`公开策略里的 min_supported_version 是 "${minSeen}"，期望 "${minSupported || version}"`)
  }
  console.log(`  ✓ 公开策略 min_supported_version=${minSeen}`)
  if (res.headers.get('cache-control')) console.log(`  cache-control: ${res.headers.get('cache-control')}`)
  // 清单里的下载地址必须和这次用的镜像一致，否则客户端还会去直连 GitHub 慢慢爬
  if (!text.includes(installerUrl)) fail('公开清单里的下载地址与本次生成的地址不一致')
  console.log(`  ✓ 清单下载地址 ${mirrorPrefix ? '已走加速前缀' : '为 GitHub 直连'}`)

  console.log(`\n✓ 发布完成：${tag}\n  下载地址 ${installerUrl}\n  官方附件 ${officialUrl}\n  清单     ${publicManifest}\n`)
}

main().catch((err) => fail(err?.status ? err.message : err?.stack || String(err)))
