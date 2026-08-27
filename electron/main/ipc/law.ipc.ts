import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync } from 'fs'
import { basename, extname } from 'path'
import { IPC_CHANNELS, type ImportResult } from '../../../shared/types'
import {
  createLaw,
  findLawByTitleAndBody,
  listLaws,
  countLaws,
  getLawById,
  getArticlesByLawId,
  insertArticles,
  searchArticles,
  getArticleById,
  addRevision,
  getRevisionsByLawId,
  getRevisionById,
} from '../services/database'

import type { LawRow, ArticleRow } from '../services/database'

export function registerLawIpc(): void {
  // ---- 导入 ----
  ipcMain.handle(
    IPC_CHANNELS.LAW_IMPORT,
    async (_event, filePaths: string[]): Promise<ImportResult> => {
      const result: ImportResult = { success: true, imported: 0, skipped: 0, errors: [] }

      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i]
        try {
          const ext = extname(filePath).toLowerCase()
          if (!['.txt', '.md', '.text'].includes(ext)) {
            result.skipped++
            result.errors.push(`${basename(filePath)}: 不支持的文件格式`)
            continue
          }

          const content = readFileSync(filePath, 'utf-8')
          const parsed = parseLawFile(content, basename(filePath, ext))

          // 去重
          const existing = findLawByTitleAndBody(parsed.title, parsed.issuing_body || null)
          if (existing) {
            result.skipped++
            result.errors.push(`${parsed.title}: 已存在（标题+发文机关重复）`)
            continue
          }

          const law = createLaw({
            title: parsed.title,
            document_type: parsed.document_type,
            issuing_body: parsed.issuing_body,
            document_number: parsed.document_number,
            publish_date: parsed.publish_date,
            effective_date: parsed.effective_date,
            status: parsed.status,
            full_text: content,
          })

          insertArticles(
            parsed.articles.map((a) => ({
              law_id: law.id,
              parent_id: a.parent_id,
              level: a.level,
              order_num: a.order_num,
              article_num: a.article_num,
              title: a.title,
              content: a.content,
            }))
          )

          result.imported++

          // 发送进度事件
          const window = BrowserWindow.getAllWindows()[0]
          if (window) {
            window.webContents.send('law:import-progress', {
              current: i + 1,
              total: filePaths.length,
              fileName: parsed.title,
            })
          }
        } catch (err) {
          result.errors.push(`${basename(filePath)}: ${(err as Error).message}`)
        }
      }

      result.success = result.imported > 0
      return result
    }
  )

  // ---- 列表 ----
  ipcMain.handle(IPC_CHANNELS.LAW_LIST, (_event, params) => {
    return listLaws(params || {})
  })

  // ---- 总数 ----
  ipcMain.handle(IPC_CHANNELS.LAW_COUNT, () => {
    return countLaws()
  })

  // ---- 详情 ----
  ipcMain.handle(IPC_CHANNELS.LAW_GET_BY_ID, (_event, lawId: string) => {
    const law = getLawById(lawId)
    if (!law) return null
    const articles = getArticlesByLawId(lawId)
    return { ...law, articles }
  })

  // ---- 全文检索 ----
  ipcMain.handle(IPC_CHANNELS.LAW_SEARCH, (_event, query: string, limit?: number) => {
    return searchArticles(query, limit || 50)
  })

  // ---- 获取单条款 ----
  ipcMain.handle(IPC_CHANNELS.LAW_GET_ARTICLE, (_event, articleId: string) => {
    return getArticleById(articleId) || null
  })

  // ---- 版本列表 ----
  ipcMain.handle(IPC_CHANNELS.LAW_GET_REVISIONS, (_event, lawId: string) => {
    return getRevisionsByLawId(lawId)
  })

  // ---- 添加修订版 ----
  ipcMain.handle(
    IPC_CHANNELS.LAW_ADD_REVISION,
    (_event, data: { lawId: string; versionTag: string; changeLog?: string; fullText: string }) => {
      return addRevision({
        law_id: data.lawId,
        version_tag: data.versionTag,
        change_log: data.changeLog,
        full_text: data.fullText,
      })
    }
  )

  // ---- 获取单个版本 ----
  ipcMain.handle(IPC_CHANNELS.LAW_GET_REVISION, (_event, revisionId: string) => {
    return getRevisionById(revisionId) || null
  })
}

// ============== 法规文件解析器 ==============

interface ParsedLaw {
  title: string
  document_type: string
  issuing_body: string | undefined
  document_number: string | undefined
  publish_date: string | undefined
  effective_date: string | undefined
  status: string
  articles: Array<{
    parent_id?: string | null
    level: number
    order_num: number
    article_num?: string | null
    title?: string | null
    content: string
  }>
}

function parseLawFile(text: string, fallbackTitle: string): ParsedLaw {
  const lines = text.split(/\r?\n/)
  let title = fallbackTitle
  let issuing_body: string | undefined
  let document_number: string | undefined
  let publish_date: string | undefined
  let effective_date: string | undefined
  let document_type = '规范性文件'
  let status: string = 'effective'
  let contentStart = 0

  // 解析头部元信息
  if (lines[0]?.startsWith('# ')) {
    title = lines[0].replace(/^#\s+/, '').trim()
    contentStart = 1
  }

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i].trim()

    const issuingMatch = line.match(/^(发文机关|发布机关|颁布机关)[：:]\s*(.+)/)
    if (issuingMatch) {
      issuing_body = issuingMatch[2].trim()
      if (i < contentStart || contentStart === 0) contentStart = Math.max(contentStart, i + 1)
      continue
    }

    const numMatch = line.match(/^(发文字号|文号)[：:]\s*(.+)/)
    if (numMatch) {
      document_number = numMatch[2].trim()
      if (i < contentStart || contentStart === 0) contentStart = Math.max(contentStart, i + 1)
      continue
    }

    const pubMatch = line.match(/^(发布日期|公布日期)[：:]\s*(.+)/)
    if (pubMatch) {
      publish_date = pubMatch[2].trim()
      if (i < contentStart || contentStart === 0) contentStart = Math.max(contentStart, i + 1)
      continue
    }

    const effMatch = line.match(/^(施行日期|生效日期|实施日期)[：:]\s*(.+)/)
    if (effMatch) {
      effective_date = effMatch[2].trim()
      if (i < contentStart || contentStart === 0) contentStart = Math.max(contentStart, i + 1)
      continue
    }

    const typeMatch = line.match(/^(效力级别|文件类型)[：:]\s*(.+)/)
    if (typeMatch) {
      document_type = typeMatch[2].trim()
      continue
    }

    const statusMatch = line.match(/^(效力状态)[：:]\s*(.+)/)
    if (statusMatch) {
      const s = statusMatch[2].trim()
      if (s.includes('失效') || s.includes('废止')) status = 'repealed'
      else if (s.includes('修订') || s.includes('修正')) status = 'amended'
      else status = 'effective'
      continue
    }
  }

  // 确保跳过元信息空行
  while (contentStart < lines.length && lines[contentStart].trim() === '') {
    contentStart++
  }

  // 解析条款结构
  const bodyText = lines.slice(contentStart).join('\n')
  const articles = parseArticles(bodyText)

  return {
    title,
    document_type,
    issuing_body,
    document_number,
    publish_date,
    effective_date,
    status,
    articles,
  }
}

/** 将全文拆分为条款 */
function parseArticles(
  text: string
): Array<{
  parent_id?: string | null
  level: number
  order_num: number
  article_num?: string | null
  title?: string | null
  content: string
}> {
  // 匹配模式：第X编 → level=1, 第X章 → level=2, 第X节 → level=3, 第X条 → level=4
  const headingRegex =
    /(第[一二三四五六七八九十百千]+[编])\s*(.*?)(?:\n|$)|(第[一二三四五六七八九十百千]+章)\s*(.*?)(?:\n|$)|(第[一二三四五六七八九十百千]+节)\s*(.*?)(?:\n|$)|(第[一二三四五六七八九十百千]+条)\s*([\s\S]*?)(?=(?:\n第[一二三四五六七八九十百千]+(?:编|章|节|条))|$)/g

  const result: Array<{
    parent_id?: string | null
    level: number
    order_num: number
    article_num?: string | null
    title?: string | null
    content: string
  }> = []

  let orderNum = 0
  let currentParent: { level: number; id: string } | null = null
  const parentStack: Array<{ level: number; id: string }> = []

  let match: RegExpExecArray | null
  while ((match = headingRegex.exec(text)) !== null) {
    orderNum++
    let level = 4
    let articleNum: string | null = null
    let titleText: string | null = null
    let content: string

    if (match[1]) {
      // 编
      level = 1
      articleNum = match[1].trim()
      titleText = match[2]?.trim() || null
      content = match[0]
    } else if (match[3]) {
      // 章
      level = 2
      articleNum = match[3].trim()
      titleText = match[4]?.trim() || null
      content = match[0]
    } else if (match[5]) {
      // 节
      level = 3
      articleNum = match[5].trim()
      titleText = match[6]?.trim() || null
      content = match[0]
    } else {
      // 条
      level = 4
      articleNum = match[7].trim()
      content = (match[8] || '').trim()
    }

    // 计算 parent_id：找到最近的上级层级
    let parentId: string | null = null
    while (parentStack.length > 0 && parentStack[parentStack.length - 1].level >= level) {
      parentStack.pop()
    }
    if (parentStack.length > 0) {
      parentId = parentStack[parentStack.length - 1].id
    }

    // 为新层级创建临时 ID（生成虚拟 ID 用于建立父子关系，后续由数据库分配真实 UUID）
    const virtualId = `__virtual_${orderNum}`
    if (level < 4) {
      parentStack.push({ level, id: virtualId })
      currentParent = { level, id: virtualId }
    }

    result.push({
      parent_id: parentId, // 实际存 parent 的虚拟 ID
      level,
      order_num: orderNum,
      article_num: articleNum,
      title: titleText,
      content,
    })
  }

  // 如果没有匹配到任何结构，整篇作为一个条目
  if (result.length === 0 && text.trim()) {
    result.push({
      parent_id: null,
      level: 4,
      order_num: 1,
      article_num: null,
      title: null,
      content: text.trim(),
    })
  }

  // 第二遍：将虚拟 parent_id 替换为实际 order_num 引用
  // 重新处理：用 order_num 作为父引用
  return resolveParentRefs(result)
}

/** 将虚拟 parent_id 转换为基于 order_num 的父引用（供数据库插入时重新解析） */
function resolveParentRefs(
  articles: Array<{
    parent_id?: string | null
    level: number
    order_num: number
    article_num?: string | null
    title?: string | null
    content: string
  }>
): Array<{
  parent_id?: string | null
  level: number
  order_num: number
  article_num?: string | null
  title?: string | null
  content: string
}> {
  // 为每个非条级别的节点建立 orderNum → 虚拟ID 映射
  const levelMap = new Map<number, number>() // orderNum → parentOrderNum

  let lastPerLevel: Record<number, number> = {}

  for (const a of articles) {
    if (a.level < 4) {
      // 清除更深层级
      for (const lvl of Object.keys(lastPerLevel).map(Number)) {
        if (lvl >= a.level) delete lastPerLevel[lvl]
      }
      // 找到最近上级
      const parentLevels = Object.keys(lastPerLevel)
        .map(Number)
        .filter((l) => l < a.level)
        .sort((a, b) => b - a)
      if (parentLevels.length > 0) {
        levelMap.set(a.order_num, lastPerLevel[parentLevels[0]])
      }
      lastPerLevel[a.level] = a.order_num
    }
  }

  // 为每个条款查找父级
  for (const a of articles) {
    if (a.level === 4) {
      const parentLevels = Object.keys(lastPerLevel)
        .map(Number)
        .filter((l) => l < 4)
        .sort((a, b) => b - a)
      if (parentLevels.length > 0) {
        a.parent_id = String(lastPerLevel[parentLevels[0]])
      } else {
        a.parent_id = null
      }
    } else {
      a.parent_id = levelMap.get(a.order_num) ? String(levelMap.get(a.order_num)) : null
    }
  }

  return articles
}
