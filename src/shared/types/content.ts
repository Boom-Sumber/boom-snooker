/**
 * 站点文案类型（D31）
 *
 * 文案存在 `site_sections` / `site_points`，随快照下发（`get_dataset_snapshot().content`），
 * 所以离线也能显示。超管在「文案管理」页编辑，保存即 bump `dataset_version`。
 *
 * 注意 `body` 不是 `text`：数据库里那个列故意叫 `body`，避免和类型名 `text` 混淆。
 */

export interface SitePoint {
  label?: string | null
  body: string
}

export interface SiteSection {
  key: string
  title: string
  intro?: string | null
  sort?: number
  points: SitePoint[]
}

/** 编辑页用的草稿（多一个"是否新建"的标记） */
export interface SiteSectionDraft extends SiteSection {
  isNew?: boolean
}
