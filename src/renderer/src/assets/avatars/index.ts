/**
 * 内置头像
 *
 * 头像**不存 URL，只存 key**（`avatar-boy` / `avatar-girl`），渲染时映射到打包进来的
 * PNG。理由：
 *   - 头像不占 Storage 额度、不产生出口流量（免费额度的红线是图片流量）
 *   - 用户只能在这几张里选，没必要开放上传（也就没有 Storage 写权限的风险）
 *   - 换图时只改这里的映射，数据库里的值不用动
 *
 * 性别只决定**默认**头像；用户可以在两张里任选（`avatar` 有值时优先用它）。
 */
import avatarBoy from './avatar-boy.png'
import avatarGirl from './avatar-girl.png'

export type Gender = 'male' | 'female'
export type AvatarKey = 'avatar-boy' | 'avatar-girl'

export interface AvatarOption {
  key: AvatarKey
  label: string
  src: string
}

export const AVATARS: AvatarOption[] = [
  { key: 'avatar-boy', label: '男生头像', src: avatarBoy },
  { key: 'avatar-girl', label: '女生头像', src: avatarGirl }
]

export const GENDER_LABELS: Record<Gender, string> = {
  male: '男',
  female: '女'
}

/** 性别 → 默认头像 */
export const DEFAULT_AVATAR: Record<Gender, AvatarKey> = {
  male: 'avatar-boy',
  female: 'avatar-girl'
}

export function normalizeGender(value: string | null | undefined): Gender {
  return value === 'female' ? 'female' : 'male'
}

/**
 * 头像 key → 图片地址
 *
 * 库里是 null（老用户）或者存了个不认识的 key 时，按性别回落，
 * 保证界面上永远不会出现裂图。
 */
export function resolveAvatar(
  avatar: string | null | undefined,
  gender: string | null | undefined
): string {
  const matched = AVATARS.find((item) => item.key === avatar)
  if (matched) return matched.src

  const fallbackKey = DEFAULT_AVATAR[normalizeGender(gender)]
  return AVATARS.find((item) => item.key === fallbackKey)?.src ?? avatarBoy
}
