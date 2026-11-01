<script setup lang="ts">
/**
 * 作者展示（D30）
 *
 * 账号停用后，历史内容与评论都还在（D25 软删除，不删数据），
 * 读者需要知道"这个作者已经不在圈子了"，所以在昵称后面挂一枚灰胶囊。
 *
 * 数据来源：
 *   · 内容（彩球 / 进阶）—— 快照里的 `author_deleted`（服务端按 `owner_id → profiles.deleted_at` 算好）
 *   · 评论 —— 评论 RPC 实时 join 返回（评论不进快照）
 */
defineProps<{
  /** 作者昵称（记录里存的是 `updated_by` 文本，不是 join 出来的） */
  name?: string | null
  /** 作者账号是否已停用 */
  deleted?: boolean
}>()
</script>

<template>
  <span class="author">
    <span class="author__name">{{ name || '未知' }}</span>
    <span v-if="deleted" class="author__tag" title="该账户已停用，内容保留">已停用</span>
  </span>
</template>

<style scoped>
.author {
  display: inline-flex;
  gap: 0.375rem;
  align-items: center;
  min-width: 0;
  vertical-align: bottom;
}

.author__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.author__tag {
  flex: none;
  padding: 0 0.375rem;
  font-size: var(--font-size-sm);
  line-height: 1.5;
  color: var(--text-2);
  background: var(--surface-2);
  border-radius: 999px;
}
</style>
