/**
 * SQLite 存储的时间为 UTC（无时区标记），
 * 前端 new Date() 会错误解析为本地时间。
 * 加 Z 后缀标记为 UTC，toLocaleString 才能正确转换。
 */
export function parseUTCDate(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date()
  // 如果已经有时区标记则直接解析
  if (dateStr.endsWith('Z') || dateStr.includes('+') || dateStr.includes('T')) {
    return new Date(dateStr)
  }
  // SQLite datetime('now') 格式: "YYYY-MM-DD HH:MM:SS" → 加 Z
  return new Date(dateStr.replace(' ', 'T') + 'Z')
}

export function formatDateTime(dateStr: string | null | undefined): string {
  return parseUTCDate(dateStr).toLocaleString('zh-CN')
}

export function formatDate(dateStr: string | null | undefined): string {
  return parseUTCDate(dateStr).toLocaleDateString('zh-CN')
}
