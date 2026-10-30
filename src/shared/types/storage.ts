/**
 * 本地缓存存储的类型契约（主进程 / 预加载 / 渲染进程共用）
 *
 * 只放跨进程接口，读写逻辑在 `src/main/store.ts`（主进程）和
 * `src/shared/storage/local.ts`（业务层封装）。
 */

/** 缓存文件的基本信息，用于判断"要不要重下" */
export interface CacheFileInfo {
  /** 文件大小（字节） */
  size: number
  /** 最后修改时间（毫秒时间戳） */
  mtime: number
}

/**
 * 主进程提供的能力（预加载暴露为 `window.api.store`）
 *
 * 参数 `name` 是**逻辑名**（如 `dataset`），不是路径。
 * 主进程负责拼成 `<userData>/cache/<name>.json` 并做合法性校验 ——
 * 渲染进程不能指定任意路径，避免被注入 `../` 写到别处。
 */
export interface LocalStoreApi {
  /** 读原始 JSON 文本；文件不存在或读失败返回 null */
  read(name: string): Promise<string | null>
  /** 写原始 JSON 文本（原子替换：先写 .tmp 再 rename） */
  write(name: string, content: string): Promise<void>
  /** 删除；不存在也不报错 */
  remove(name: string): Promise<void>
  /** 文件信息；不存在返回 null */
  stat(name: string): Promise<CacheFileInfo | null>
}
