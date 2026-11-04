/**
 * 版本比较与最低可用版本（2026-11-04）
 *
 * 单独一个文件、不 import electron：这样既方便被主进程更新器复用，
 * 也能直接用 `node --experimental-strip-types` 跑几行断言验证逻辑
 * （见 `docs/01` T12.9 的实测记录）。
 *
 * 最低版本有两层来源，取**更严的那个**：
 *   1. 服务端 `policy.json` 的 `min_supported_version` —— 发布时用 `--min` 指定，
 *      随时能调高而不用发新版本（推荐的主要手段）
 *   2. 这里的 `MIN_SUPPORTED_VERSION` —— 编译进客户端的兜底。
 *      作用有两个：policy 拉不到时仍然有一道门槛；以及防止某次发布手滑把
 *      `--min` 写成很低的值，把所有人放回旧版
 *
 * ⚠️ 这个常量只能约束**比它新的**构建（老构建里根本没有这段代码）。
 *    所以要抬门槛，必须发一版新包，再指望这一版去强制更老的版本。
 */
export const MIN_SUPPORTED_VERSION = '0.2.2'

/** `1.2.3` / `v1.2.3` / `1.2.3-beta.1` → `[1,2,3]`（只取前三段数字，够用且不引依赖） */
export function versionParts(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0)
}

/** <0 表示 a 更低，0 相等，>0 更高 */
export function compareVersion(a: string, b: string): number {
  const left = versionParts(a)
  const right = versionParts(b)
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * 算出生效的最低可用版本
 *
 * 服务端给了就用它，但**不能低于**代码里的兜底 —— 取两者更高者。
 * 服务端没给（policy 404 / 拉取失败 / 字段为空）时用兜底。
 */
export function resolveMinVersion(policyMin: string | null | undefined): string {
  const policy = typeof policyMin === 'string' ? policyMin.trim() : ''
  if (!policy) return MIN_SUPPORTED_VERSION
  return compareVersion(policy, MIN_SUPPORTED_VERSION) >= 0 ? policy : MIN_SUPPORTED_VERSION
}
