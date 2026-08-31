import Database from 'better-sqlite3'
import { app } from 'electron'
import { join, dirname } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'

let db: Database.Database | null = null

/** 获取或初始化数据库实例 */
export function getDatabase(): Database.Database {
  if (db) return db

  const userDataPath = app.getPath('userData')
  const lawpilotDir = join(userDataPath, 'LawPilot')
  const dbPath = join(lawpilotDir, 'lawpilot.db')

  // 确保目录存在
  if (!existsSync(lawpilotDir)) {
    mkdirSync(lawpilotDir, { recursive: true })
  }

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  initializeSchema(db)
  return db
}

/** 关闭数据库连接 */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

/** 初始化表结构与触发器 */
function initializeSchema(db: Database.Database): void {
  db.exec(`
    -- 法规主表
    CREATE TABLE IF NOT EXISTS laws (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      document_type TEXT NOT NULL DEFAULT '规范性文件',
      issuing_body TEXT,
      document_number TEXT,
      publish_date TEXT,
      effective_date TEXT,
      status TEXT NOT NULL DEFAULT 'effective',
      full_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_laws_type ON laws(document_type);
    CREATE INDEX IF NOT EXISTS idx_laws_status ON laws(status);
    CREATE INDEX IF NOT EXISTS idx_laws_title ON laws(title);

    -- 条款表
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      law_id TEXT NOT NULL REFERENCES laws(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES articles(id),
      level INTEGER NOT NULL DEFAULT 4,
      order_num INTEGER NOT NULL,
      article_num TEXT,
      title TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_articles_law ON articles(law_id);
    CREATE INDEX IF NOT EXISTS idx_articles_parent ON articles(parent_id);
    CREATE INDEX IF NOT EXISTS idx_articles_level ON articles(law_id, level);

    -- FTS5 全文索引虚拟表
    CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
      article_num,
      title,
      content,
      content=articles,
      content_rowid=rowid
    );

    -- FTS5 同步触发器
    CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
      INSERT INTO articles_fts(rowid, article_num, title, content)
      VALUES (new.rowid, new.article_num, new.title, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
      INSERT INTO articles_fts(articles_fts, rowid, article_num, title, content)
      VALUES ('delete', old.rowid, old.article_num, old.title, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
      INSERT INTO articles_fts(articles_fts, rowid, article_num, title, content)
      VALUES ('delete', old.rowid, old.article_num, old.title, old.content);
      INSERT INTO articles_fts(rowid, article_num, title, content)
      VALUES (new.rowid, new.article_num, new.title, new.content);
    END;

    -- 版本表
    CREATE TABLE IF NOT EXISTS revisions (
      id TEXT PRIMARY KEY,
      law_id TEXT NOT NULL REFERENCES laws(id) ON DELETE CASCADE,
      version_tag TEXT NOT NULL,
      change_log TEXT,
      full_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_revisions_law ON revisions(law_id);

    -- 案件表
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      case_number TEXT,
      title TEXT NOT NULL,
      case_type TEXT NOT NULL,
      case_status TEXT NOT NULL DEFAULT 'active',
      court TEXT,
      client TEXT,
      opponent TEXT,
      filing_date TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cases_type ON cases(case_type);
    CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(case_status);
    CREATE INDEX IF NOT EXISTS idx_cases_number ON cases(case_number);

    -- 材料表
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY,
      case_id TEXT REFERENCES cases(id) ON DELETE SET NULL,
      original_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      mime_type TEXT,
      file_size INTEGER,
      raw_text TEXT,
      ocr_status TEXT NOT NULL DEFAULT 'pending',
      ocr_error TEXT,
      category TEXT DEFAULT '其他',
      category_confidence REAL DEFAULT 0,
      page_count INTEGER DEFAULT 1,
      evidence_no TEXT DEFAULT '',
      proof_purpose TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_materials_case ON materials(case_id);
    CREATE INDEX IF NOT EXISTS idx_materials_hash ON materials(file_hash);

    -- 案件动态表
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      description TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_activities_case ON activities(case_id);
  `)

  // ALTER TABLE ADD COLUMN 在列已存在时会报错，忽略此错误
  try {
    db.exec(`ALTER TABLE cases ADD COLUMN volume_order TEXT`)
  } catch {
    // 列已存在，忽略
  }

  try {
    db.exec(`ALTER TABLE cases ADD COLUMN client TEXT`)
  } catch {
    // 列已存在，忽略
  }

  try {
    db.exec(`ALTER TABLE cases ADD COLUMN opponent TEXT`)
  } catch {
    // 列已存在，忽略
  }

  try {
    db.exec(`ALTER TABLE materials ADD COLUMN evidence_no TEXT DEFAULT ''`)
  } catch {
    // 列已存在，忽略
  }

  try {
    db.exec(`ALTER TABLE materials ADD COLUMN proof_purpose TEXT DEFAULT ''`)
  } catch {
    // 列已存在，忽略
  }

  // conversations + usage_logs 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      conv_type TEXT NOT NULL DEFAULT 'chat',
      messages TEXT NOT NULL DEFAULT '[]',
      model TEXT,
      total_tokens INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      conv_id TEXT,
      model TEXT,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- system_config 键值对存储
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  migrateArticleParents(db)
}

/**
 * 存量数据迁移：早期版本把父条款的 order_num（如 "5"）直接存进 parent_id，
 * 导致前端按 UUID 建树时匹配失败。把这类引用解析为真实条款 UUID。
 * 只处理"parent_id 不是任何条款 id、但等于同法下某条款 order_num"的行，幂等。
 */
function migrateArticleParents(db: Database.Database): void {
  db.exec(`
    UPDATE articles SET parent_id = (
      SELECT p.id FROM articles p
      WHERE p.law_id = articles.law_id
        AND CAST(p.order_num AS TEXT) = articles.parent_id
    )
    WHERE parent_id IS NOT NULL
      AND parent_id NOT IN (SELECT id FROM articles)
  `)
}

/** 获取数据库状态信息 */
export function getDatabaseStatus(): {
  path: string
  tables: string[]
  lawCount: number
  articleCount: number
  caseCount: number
} {
  const database = getDatabase()

  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r: unknown) => (r as { name: string }).name)

  const lawCount = database.prepare('SELECT COUNT(*) as count FROM laws').get() as { count: number }
  const articleCount = database.prepare('SELECT COUNT(*) as count FROM articles').get() as {
    count: number
  }
  const caseCount = database.prepare('SELECT COUNT(*) as count FROM cases').get() as {
    count: number
  }

  return {
    path: database.name,
    tables,
    lawCount: lawCount.count,
    articleCount: articleCount.count,
    caseCount: caseCount.count,
  }
}

// ---- 法规 CRUD ----

export interface LawRow {
  id: string
  title: string
  document_type: string
  issuing_body: string | null
  document_number: string | null
  publish_date: string | null
  effective_date: string | null
  status: string
  full_text: string
  created_at: string
  updated_at: string
}

export interface ArticleRow {
  id: string
  law_id: string
  parent_id: string | null
  level: number
  order_num: number
  article_num: string | null
  title: string | null
  content: string
  created_at: string
}

export interface RevisionRow {
  id: string
  law_id: string
  version_tag: string
  change_log: string | null
  full_text: string
  created_at: string
}

export interface CaseRow {
  id: string
  case_number: string | null
  title: string
  case_type: string
  case_status: string
  court: string | null
  client: string | null
  opponent: string | null
  filing_date: string | null
  description: string | null
  volume_order: string | null
  created_at: string
  updated_at: string
}

/** 创建法规 */
export function createLaw(data: {
  title: string
  document_type?: string
  issuing_body?: string
  document_number?: string
  publish_date?: string
  effective_date?: string
  status?: string
  full_text: string
}): LawRow {
  const db = getDatabase()
  const id = uuidv4()
  db.prepare(
    `INSERT INTO laws (id, title, document_type, issuing_body, document_number, publish_date, effective_date, status, full_text)
     VALUES (@id, @title, @document_type, @issuing_body, @document_number, @publish_date, @effective_date, @status, @full_text)`
  ).run({ id, document_type: '规范性文件', status: 'effective', ...data })
  return db.prepare('SELECT * FROM laws WHERE id = ?').get(id) as LawRow
}

/** 根据 title + issuing_body 查重 */
export function findLawByTitleAndBody(
  title: string,
  issuingBody: string | null
): LawRow | undefined {
  const db = getDatabase()
  return db
    .prepare('SELECT * FROM laws WHERE title = ? AND issuing_body IS ?')
    .get(title, issuingBody) as LawRow | undefined
}

/** 查询法规列表 */
export function listLaws(params: {
  document_type?: string
  status?: string
  keyword?: string
  page?: number
  pageSize?: number
}): { items: LawRow[]; total: number } {
  const db = getDatabase()
  const conditions: string[] = []
  const values: Record<string, string | number> = {}

  if (params.document_type) {
    conditions.push('document_type = @document_type')
    values.document_type = params.document_type
  }
  if (params.status) {
    conditions.push('status = @status')
    values.status = params.status
  }
  if (params.keyword) {
    // 同时匹配法规名称和条文内容（含条号）
    conditions.push(
      `(title LIKE '%' || @keyword || '%'
        OR id IN (
          SELECT DISTINCT law_id FROM articles
          WHERE content LIKE '%' || @keyword || '%'
             OR article_num LIKE '%' || @keyword || '%'
        ))`
    )
    values.keyword = params.keyword
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const page = params.page || 1
  const pageSize = params.pageSize || 20

  const total = (
    db.prepare(`SELECT COUNT(*) as count FROM laws ${where}`).get(values) as { count: number }
  ).count
  const items = db
    .prepare(
      `SELECT * FROM laws ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`
    )
    .all({ ...values, limit: pageSize, offset: (page - 1) * pageSize }) as LawRow[]

  return { items, total }
}

/** 删除法规（连同其全部条款，FTS 索引由触发器同步清理） */
export function deleteLaw(id: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM articles WHERE law_id = ?').run(id)
  db.prepare('DELETE FROM laws WHERE id = ?').run(id)
}

/** 获取法规总数 */
export function countLaws(): number {
  const db = getDatabase()
  return (db.prepare('SELECT COUNT(*) as count FROM laws').get() as { count: number }).count
}

/** 获取法规详情 */
export function getLawById(id: string): LawRow | undefined {
  const db = getDatabase()
  return db.prepare('SELECT * FROM laws WHERE id = ?').get(id) as LawRow | undefined
}

/** 获取法规的全部条款（按 order_num 排序） */
export function getArticlesByLawId(lawId: string): ArticleRow[] {
  const db = getDatabase()
  return db
    .prepare('SELECT * FROM articles WHERE law_id = ? ORDER BY order_num ASC')
    .all(lawId) as ArticleRow[]
}

// ---- 条款操作 ----

let insertArticleStmt: Database.Statement | null = null

/** 批量插入条款（使用事务）。入参 parent_id 为父条款 order_num 的字符串（parseLawFile 产出），此处解析为真实父级 UUID */
export function insertArticles(
  articles: Array<{
    law_id: string
    parent_id?: string | null
    level?: number
    order_num: number
    article_num?: string | null
    title?: string | null
    content: string
  }>
): void {
  const db = getDatabase()

  if (!insertArticleStmt) {
    insertArticleStmt = db.prepare(
      `INSERT INTO articles (id, law_id, parent_id, level, order_num, article_num, title, content)
       VALUES (@id, @law_id, @parent_id, @level, @order_num, @article_num, @title, @content)`
    )
  }

  // 先为所有条款分配 UUID，构建 "lawId:orderNum" → id 映射，再解析父引用
  const idByKey = new Map<string, string>()
  const prepared = articles.map((a) => {
    const id = uuidv4()
    idByKey.set(`${a.law_id}:${a.order_num}`, id)
    return { ...a, id }
  })

  const insertMany = db.transaction(
    (
      items: Array<{
        id: string
        law_id: string
        parent_id?: string | null
        level?: number
        order_num: number
        article_num?: string | null
        title?: string | null
        content: string
      }>
    ) => {
      for (const a of items) {
        const parentNum = a.parent_id != null ? Number(a.parent_id) : NaN
        const parentId =
          Number.isInteger(parentNum) ? idByKey.get(`${a.law_id}:${parentNum}`) ?? null : null
        insertArticleStmt!.run({
          id: a.id,
          law_id: a.law_id,
          parent_id: parentId,
          level: a.level || 4,
          order_num: a.order_num,
          article_num: a.article_num || null,
          title: a.title || null,
          content: a.content,
        })
      }
    }
  )

  insertMany(prepared)
}

// ---- 全文检索 ----

export interface SearchResultRow {
  id: string
  law_id: string
  article_num: string | null
  content: string
  law_title: string
  snippet: string
}

/** 全文检索：LIKE 子串匹配为主（中文可靠），FTS5 辅助排序，合并去重 */
export function searchArticles(query: string, limit = 50): SearchResultRow[] {
  const db = getDatabase()
  const raw = query.trim()
  if (!raw) return []

  let keywordParams: string[] = []
  let keywords: string[] = []
  if (raw.includes(' ')) {
    keywords = raw.split(/\s+/).filter(Boolean)
  } else {
    keywords = [raw]
  }

  // ---- 1. LIKE 主检索：多关键词 AND，提升精度 ----
  const likeParts = keywords.map(() => '(a.content LIKE ? OR a.title LIKE ? OR a.article_num LIKE ?)')
  const likeSql = likeParts.join(' AND ')
  const likeParams: string[] = []
  for (const kw of keywords) {
    const p = `%${kw}%`
    likeParams.push(p, p, p)
  }

  let likeRows: SearchResultRow[]
  try {
    likeRows = db
      .prepare(
        `SELECT a.id, a.law_id, a.article_num, a.content,
                l.title AS law_title, substr(a.content, 1, 120) AS snippet
         FROM articles a JOIN laws l ON a.law_id = l.id
         WHERE ${likeSql}
         ORDER BY l.title, a.order_num
         LIMIT ?`
      )
      .all(...likeParams, limit) as SearchResultRow[]
  } catch {
    likeRows = []
  }

  const seen = new Set<string>()
  const merged: SearchResultRow[] = []
  for (const r of likeRows) {
    if (!seen.has(r.id)) {
      seen.add(r.id)
      merged.push(r)
    }
  }

  // 多关键词 AND 无结果 → 降级为整句 OR 匹配（混合中英"民法典 第681条"）
  if (merged.length === 0) {
    const pattern = `%${raw}%`
    const rows = db
      .prepare(
        `SELECT a.id, a.law_id, a.article_num, a.content,
                l.title AS law_title, substr(a.content, 1, 120) AS snippet
         FROM articles a JOIN laws l ON a.law_id = l.id
         WHERE a.content LIKE ? OR a.title LIKE ? OR a.article_num LIKE ?
         ORDER BY l.title, a.order_num
         LIMIT ?`
      )
      .all(pattern, pattern, pattern, limit) as SearchResultRow[]
    for (const r of rows) {
      if (!seen.has(r.id)) {
        seen.add(r.id)
        merged.push(r)
      }
    }
  }

  // ---- 2. FTS5 辅助：仅当 LIKE 结果不足时补充候选 ----
  // 注意：FTS5 默认 tokenizer 对中文整句分词效果差，仅作为补充
  if (merged.length < limit) {
    try {
      // 把整句转成语义 token（非空格分隔则逐字拆分为 2-gram 提升中文召回）
      const ftsQuery = buildFtsQuery(raw)
      if (ftsQuery) {
        const ftsRows = db
          .prepare(
            `SELECT
              a.id, a.law_id, a.article_num, a.content,
              l.title AS law_title,
              snippet(articles_fts, 2, '<mark>', '</mark>', '...', 40) AS snippet
            FROM articles_fts f
            JOIN articles a ON f.rowid = a.rowid
            JOIN laws l ON a.law_id = l.id
            WHERE articles_fts MATCH @query
            ORDER BY rank
            LIMIT @limit`
          )
          .all({ query: ftsQuery, limit }) as SearchResultRow[]
        for (const r of ftsRows) {
          if (!seen.has(r.id)) {
            seen.add(r.id)
            merged.push(r)
          }
        }
      }
    } catch {
      // FTS5 语法错误，忽略（LIKE 结果已足够）
    }
  }

  return merged.slice(0, limit)
}

/**
 * 构造 FTS5 MATCH 查询。
 * 对中文（无空格）整句先做 2-gram 拆分，提升 tokenizer 召回；
 * 效果有限但可补充 LIKE 未覆盖的变体。
 */
function buildFtsQuery(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, ' ')
  if (!t) return null

  // 含空格：各词独立 AND（词可能是中文，tokenizer 对单词长串可能无命中）
  if (t.includes(' ')) {
    const parts = t
      .split(' ')
      .filter(Boolean)
      .map((w) => `"${w}"*`)
      .join(' AND ')
    return parts || null
  }

  // 纯中文字符串：拆 2-gram 提升召回（如"合同的订立" → "合同" "同的" "的订" "订立"）
  if (/[\u4e00-\u9fa5]/.test(t) && t.length >= 2) {
    const grams: string[] = []
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2)
      if (/[\u4e00-\u9fa5]/.test(g)) grams.push(`"${g}"`)
    }
    // 2-gram 之间用 OR，避免 AND 过严导致零命中
    return grams.length > 0 ? grams.join(' OR ') : null
  }

  // 英文/数字：前缀匹配
  return `"${t}"*`
}

/** 根据 articleId 获取条款所在法规的条款列表（用于定位跳转） */
export function getArticleById(articleId: string): ArticleRow | undefined {
  const db = getDatabase()
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId) as
    | ArticleRow
    | undefined
}

// ---- 版本管理 ----

/** 获取某法规的所有修订版本 */
export function getRevisionsByLawId(lawId: string): RevisionRow[] {
  const db = getDatabase()
  return db
    .prepare('SELECT * FROM revisions WHERE law_id = ? ORDER BY created_at DESC')
    .all(lawId) as RevisionRow[]
}

/** 添加修订版本 */
export function addRevision(data: {
  law_id: string
  version_tag: string
  change_log?: string
  full_text: string
}): RevisionRow {
  const db = getDatabase()
  const id = uuidv4()
  db.prepare(
    `INSERT INTO revisions (id, law_id, version_tag, change_log, full_text)
     VALUES (@id, @law_id, @version_tag, @change_log, @full_text)`
  ).run({ id, ...data, change_log: data.change_log || null })
  return db.prepare('SELECT * FROM revisions WHERE id = ?').get(id) as RevisionRow
}

/** 获取单个修订版本 */
export function getRevisionById(id: string): RevisionRow | undefined {
  const db = getDatabase()
  return db.prepare('SELECT * FROM revisions WHERE id = ?').get(id) as RevisionRow | undefined
}

// ---- 案件 CRUD ----

/** 创建案件 */
export function createCase(data: {
  case_number?: string
  title: string
  case_type: string
  court?: string
  client?: string
  opponent?: string
  filing_date?: string
  description?: string
}): CaseRow {
  const db = getDatabase()
  const id = uuidv4()
  db.prepare(
    `INSERT INTO cases (id, case_number, title, case_type, court, client, opponent, filing_date, description)
     VALUES (@id, @case_number, @title, @case_type, @court, @client, @opponent, @filing_date, @description)`
  ).run({
    id,
    case_number: data.case_number || null,
    title: data.title,
    case_type: data.case_type,
    court: data.court || null,
    client: data.client || null,
    opponent: data.opponent || null,
    filing_date: data.filing_date || null,
    description: data.description || null,
  })
  return db.prepare('SELECT * FROM cases WHERE id = ?').get(id) as CaseRow
}

/** 查询案件列表 */
export function listCases(params: {
  case_type?: string
  case_status?: string
}): CaseRow[] {
  const db = getDatabase()
  const conditions: string[] = []
  const values: Record<string, string> = {}

  if (params.case_type) {
    conditions.push('case_type = @case_type')
    values.case_type = params.case_type
  }
  if (params.case_status) {
    conditions.push('case_status = @case_status')
    values.case_status = params.case_status
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  return db.prepare(`SELECT * FROM cases ${where} ORDER BY created_at DESC`).all(values) as CaseRow[]
}

/** 获取案件总数 */
export function countCases(): number {
  const db = getDatabase()
  return (db.prepare('SELECT COUNT(*) as count FROM cases').get() as { count: number }).count
}

/** 获取单个案件 */
export function getCaseById(id: string): CaseRow | undefined {
  const db = getDatabase()
  return db.prepare('SELECT * FROM cases WHERE id = ?').get(id) as CaseRow | undefined
}

/** 更新案件 */
export function updateCase(
  id: string,
  data: {
    case_number?: string
    title?: string
    case_type?: string
    case_status?: string
    court?: string
    client?: string
    opponent?: string
    filing_date?: string
    description?: string
    volume_order?: string
  }
): CaseRow | undefined {
  const db = getDatabase()
  const sets: string[] = ['updated_at = datetime(\'now\')']
  const values: Record<string, string> = { id }
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) {
      sets.push(`${k} = @${k}`)
      values[k] = v
    }
  }
  db.prepare(`UPDATE cases SET ${sets.join(', ')} WHERE id = @id`).run(values)
  return db.prepare('SELECT * FROM cases WHERE id = ?').get(id) as CaseRow | undefined
}

/** 删除案件 */
export function deleteCase(id: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM cases WHERE id = ?').run(id)
}

// ---- 材料 && 动态类型 ----

export interface MaterialRow {
  id: string
  case_id: string | null
  original_name: string
  stored_path: string
  file_hash: string
  mime_type: string | null
  file_size: number | null
  raw_text: string | null
  ocr_status: string
  ocr_error: string | null
  category: string
  category_confidence: number
  evidence_no: string
  proof_purpose: string
  page_count: number
  created_at: string
}

export interface ActivityRow {
  id: string
  case_id: string
  action: string
  description: string | null
  metadata: string | null
  created_at: string
}

// ---- 材料 CRUD ----

export function createMaterial(data: {
  case_id?: string | null
  original_name: string
  stored_path: string
  file_hash: string
  mime_type?: string
  file_size?: number
  page_count?: number
}): MaterialRow {
  const db = getDatabase()
  const id = uuidv4()
  db.prepare(
    `INSERT INTO materials (id, case_id, original_name, stored_path, file_hash, mime_type, file_size, page_count)
     VALUES (@id, @case_id, @original_name, @stored_path, @file_hash, @mime_type, @file_size, @page_count)`
  ).run({
    id,
    case_id: data.case_id || null,
    original_name: data.original_name,
    stored_path: data.stored_path,
    file_hash: data.file_hash,
    mime_type: data.mime_type || null,
    file_size: data.file_size || null,
    page_count: data.page_count || 1,
  })
  return db.prepare('SELECT * FROM materials WHERE id = ?').get(id) as MaterialRow
}

export function getMaterialById(id: string): MaterialRow | undefined {
  const db = getDatabase()
  return db.prepare('SELECT * FROM materials WHERE id = ?').get(id) as MaterialRow | undefined
}

export function listMaterialsByCase(caseId: string): MaterialRow[] {
  const db = getDatabase()
  return db
    .prepare('SELECT * FROM materials WHERE case_id = ? ORDER BY created_at DESC')
    .all(caseId) as MaterialRow[]
}

export function listAllMaterials(limit = 5): MaterialRow[] {
  const db = getDatabase()
  return db
    .prepare('SELECT * FROM materials ORDER BY created_at DESC LIMIT ?')
    .all(limit) as MaterialRow[]
}

export function countMaterials(): number {
  const db = getDatabase()
  return (db.prepare('SELECT COUNT(*) as count FROM materials').get() as { count: number }).count
}

export function linkMaterialToCase(materialId: string, caseId: string): void {
  const db = getDatabase()
  // 空字符串视为取消关联，设为 NULL
  db.prepare('UPDATE materials SET case_id = CASE WHEN @caseId = \'\' THEN NULL ELSE @caseId END WHERE id = @id')
    .run({ caseId, id: materialId })
}

export function updateMaterialOcr(
  id: string,
  rawText: string,
  status: string,
  error?: string
): void {
  const db = getDatabase()
  db.prepare(
    'UPDATE materials SET raw_text = ?, ocr_status = ?, ocr_error = ? WHERE id = ?'
  ).run(rawText, status, error || null, id)
}

export function updateMaterialCategory(
  id: string,
  category: string,
  confidence: number
): void {
  const db = getDatabase()
  db.prepare(
    'UPDATE materials SET category = ?, category_confidence = ? WHERE id = ?'
  ).run(category, confidence, id)
}

/** 更新材料的证据编号与证明目的（用于卷宗归档证据清单） */
export function updateMaterialEvidence(
  id: string,
  evidenceNo: string,
  proofPurpose: string
): void {
  const db = getDatabase()
  db.prepare(
    'UPDATE materials SET evidence_no = ?, proof_purpose = ? WHERE id = ?'
  ).run(evidenceNo, proofPurpose, id)
}

export function deleteMaterial(id: string): void {
  const db = getDatabase()
  // 同时删除关联的物理文件
  const material = db.prepare('SELECT stored_path FROM materials WHERE id = ?').get(id) as { stored_path: string } | undefined
  db.prepare('DELETE FROM materials WHERE id = ?').run(id)
  if (material?.stored_path) {
    try {
      const fs = require('fs')
      if (fs.existsSync(material.stored_path)) {
        fs.unlinkSync(material.stored_path)
      }
    } catch {
      // 文件删除失败不阻塞
    }
  }
}

// ---- 案件动态 ----

export function createActivity(
  caseId: string,
  action: string,
  description: string,
  metadata?: string
): ActivityRow {
  const db = getDatabase()
  const id = uuidv4()
  db.prepare(
    `INSERT INTO activities (id, case_id, action, description, metadata)
     VALUES (@id, @case_id, @action, @description, @metadata)`
  ).run({ id, case_id: caseId, action, description, metadata: metadata || null })
  return db.prepare('SELECT * FROM activities WHERE id = ?').get(id) as ActivityRow
}

export function getActivitiesByCase(caseId: string): ActivityRow[] {
  const db = getDatabase()
  return db
    .prepare('SELECT * FROM activities WHERE case_id = ? ORDER BY created_at DESC')
    .all(caseId) as ActivityRow[]
}

// ---- System Config ----

export function getConfigValue(key: string): string {
  const db = getDatabase()
  const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value || ''
}

export function setConfigValue(key: string, value: string): void {
  const db = getDatabase()
  db.prepare(
    'INSERT INTO system_config (key, value, updated_at) VALUES (@key, @value, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = datetime(\'now\')'
  ).run({ key, value })
}

// ---- Conversations ----

export interface ConvRow {
  id: string
  title: string | null
  conv_type: string
  messages: string
  model: string | null
  total_tokens: number
  created_at: string
  updated_at: string
}

export function createConversation(title?: string, conv_type = 'chat'): ConvRow {
  const db = getDatabase()
  const id = uuidv4()
  db.prepare(
    'INSERT INTO conversations (id, title, conv_type) VALUES (@id, @title, @conv_type)'
  ).run({ id, title: title || null, conv_type })
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConvRow
}

export function listConversations(): ConvRow[] {
  const db = getDatabase()
  return db
    .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
    .all() as ConvRow[]
}

export function updateConversationMessages(
  id: string,
  messagesJson: string,
  tokenDelta: number = 0
): void {
  const db = getDatabase()
  db.prepare(
    "UPDATE conversations SET messages = @messages, total_tokens = total_tokens + @delta, updated_at = datetime('now') WHERE id = @id"
  ).run({ messages: messagesJson, delta: tokenDelta, id })
}

export function deleteConversation(id: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM usage_logs WHERE conv_id = ?').run(id)
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

// ---- Usage Logs ----

export interface UsageLogRow {
  id: string
  conv_id: string | null
  model: string | null
  prompt_tokens: number
  completion_tokens: number
  created_at: string
}

export function createUsageLog(
  convId: string | null,
  model: string | null,
  promptTokens: number,
  completionTokens: number
): void {
  const db = getDatabase()
  db.prepare(
    'INSERT INTO usage_logs (id, conv_id, model, prompt_tokens, completion_tokens) VALUES (@id, @conv_id, @model, @prompt_tokens, @completion_tokens)'
  ).run({
    id: uuidv4(),
    conv_id: convId || null,
    model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
  })
}

export function getUsageStats(period: 'today' | 'week' | 'month' = 'today'): {
  calls: number
  total_prompt_tokens: number
  total_completion_tokens: number
} {
  const db = getDatabase()
  let dateFilter = ''
  if (period === 'today') {
    dateFilter = "date(created_at) = date('now')"
  } else if (period === 'week') {
    dateFilter = "date(created_at) >= date('now', '-7 days')"
  } else {
    dateFilter = "date(created_at) >= date('now', '-30 days')"
  }

  const row = db
    .prepare(
      `SELECT COUNT(*) as calls, COALESCE(SUM(prompt_tokens),0) as prompt_tokens, COALESCE(SUM(completion_tokens),0) as completion_tokens FROM usage_logs WHERE ${dateFilter}`
    )
    .get() as { calls: number; prompt_tokens: number; completion_tokens: number }

  return {
    calls: row.calls,
    total_prompt_tokens: row.prompt_tokens,
    total_completion_tokens: row.completion_tokens,
  }
}
