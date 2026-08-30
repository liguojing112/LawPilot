// ============================================================
// LawPilot - 跨进程共享类型定义
// 主进程、渲染进程、Preload 脚本共用
// ============================================================

// ---------- IPC 通道名称常量 ----------
export const IPC_CHANNELS = {
  // 系统
  SYSTEM_PING: 'system:ping',
  SYSTEM_GET_CONFIG: 'system:get-config',
  SYSTEM_SET_CONFIG: 'system:set-config',
  SYSTEM_PYTHON_STATUS: 'system:python-status',

  // 系统
  DB_STATUS: 'db:status',

  // 法规
  LAW_SEARCH: 'law:search',
  LAW_GET_BY_ID: 'law:get-by-id',
  LAW_LIST: 'law:list',
  LAW_COUNT: 'law:count',
  LAW_IMPORT: 'law:import',
  LAW_IMPORT_PROGRESS: 'law:import-progress',
  LAW_EXPORT: 'law:export',
  LAW_COMPARE: 'law:compare',
  LAW_GET_ARTICLE: 'law:get-article',
  LAW_GET_REVISIONS: 'law:get-revisions',
  LAW_ADD_REVISION: 'law:add-revision',
  LAW_GET_REVISION: 'law:get-revision',

  // 案件
  CASE_LIST: 'case:list',
  CASE_COUNT: 'case:count',
  CASE_GET: 'case:get',
  CASE_CREATE: 'case:create',
  CASE_UPDATE: 'case:update',
  CASE_DELETE: 'case:delete',
  CASE_EXPORT: 'case:export',
  CASE_GET_ACTIVITIES: 'case:get-activities',

  // AI
  AI_CHAT: 'ai:chat',
  AI_CHAT_STREAM_CHUNK: 'ai:chat-stream-chunk',
  AI_CHAT_STREAM_DONE: 'ai:chat-stream-done',
  AI_RAG_QUERY: 'ai:rag-query',
  AI_GENERATE_REPORT: 'ai:generate-report',
  AI_SWOT_ANALYSIS: 'ai:swot-analysis',
  AI_CREATE_CONVERSATION: 'ai:create-conversation',
  AI_LIST_CONVERSATIONS: 'ai:list-conversations',
  AI_SAVE_MESSAGE: 'ai:save-message',
  AI_DELETE_CONVERSATION: 'ai:delete-conversation',
  AI_USAGE_STATS: 'ai:usage-stats',

  // 隐私
  AI_PRIVACY_PREVIEW: 'ai:privacy-preview',

  // 知识库
  KNOWLEDGE_STATUS: 'knowledge:status',
  KNOWLEDGE_REBUILD: 'knowledge:rebuild',

  // 文件
  FILE_SELECT: 'file:select',
  FILE_GET_INFO: 'file:get-info',
  FILE_STORE: 'file:store',
  FILE_READ_IMAGE: 'file:read-image',

  // 材料
  MATERIAL_IMPORT: 'material:import',
  MATERIAL_IMPORT_PROGRESS: 'material:import-progress',
  MATERIAL_PROCESSED: 'material:processed',
  MATERIAL_GET: 'material:get',
  MATERIAL_LIST_BY_CASE: 'material:list-by-case',
  MATERIAL_LINK_CASE: 'material:link-case',
  MATERIAL_CLASSIFY: 'material:classify',
  MATERIAL_UPDATE_ORDER: 'material:update-order',
  MATERIAL_UPDATE_EVIDENCE: 'material:update-evidence',
  MATERIAL_LATEST: 'material:latest',
  MATERIAL_DELETE: 'material:delete',
} as const

// ---------- 系统 ----------
export interface DbStatus {
  path: string
  tables: string[]
  lawCount: number
  articleCount: number
  caseCount: number
}

export interface SystemConfig {
  'ai.api_key': string
  'ai.base_url': string
  'ai.model': string
  'ai.privacy_prompt_enabled': string
  'python.port': string
  'python.auto_start': string
  'app.theme': string
  'app.language': string
}

export interface PythonStatus {
  running: boolean
  port: number
  version: string | null
  error: string | null
}

// ---------- 法规 ----------
export interface LawSearchFilters {
  document_type?: string
  status?: string
  keyword?: string
  page?: number
  pageSize?: number
}

export interface LawSearchResult {
  id: string
  title: string
  document_type: string
  issuing_body: string
  document_number: string
  publish_date: string
  effective_date: string
  status: string
  full_text: string
  created_at: string
  updated_at: string
}

export interface SearchResult {
  id: string
  law_id: string
  article_num: string | null
  content: string
  law_title: string
  snippet: string
}

export interface LawDetail {
  id: string
  title: string
  document_type: string
  issuing_body: string
  document_number: string
  publish_date: string
  effective_date: string
  status: string
  full_text: string
  articles: LawArticle[]
  created_at: string
  updated_at: string
}

export interface LawArticle {
  id: string
  law_id: string
  parent_id: string | null
  level: number
  order_num: number
  article_num: string | null
  title: string | null
  content: string
  children?: LawArticle[]
}

export interface Revision {
  id: string
  law_id: string
  version_tag: string
  change_log: string | null
  full_text: string
  created_at: string
}

export interface CompareResult {
  law1: LawDetail
  law2: LawDetail
  diffArticles: {
    articleNum: string
    oldContent: string
    newContent: string
    changeType: 'added' | 'removed' | 'modified' | 'unchanged'
  }[]
}

// ---------- 材料 ----------

export interface MaterialRow {
  id: string
  case_id: string | null
  original_name: string
  stored_path: string
  file_hash: string
  mime_type: string | null
  file_size: number | null
  raw_text: string | null
  ocr_status: string  // pending | processing | done | error
  ocr_error: string | null
  category: string
  category_confidence: number
  page_count: number
  evidence_no?: string
  proof_purpose?: string
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

export interface CaseMaterial {
  id: string
  caseId: string
  fileName: string
  filePath: string
  fileHash: string
  fileSize: number
  mimeType: string
  materialType: string
  ocrText: string
  ocrStatus: 'pending' | 'processing' | 'done' | 'error'
  ocrError: string
  entities: MaterialEntities | null
  pageCount: number
  importedAt: string
}

export interface MaterialEntities {
  persons: string[]
  orgs: string[]
  dates: string[]
  amounts: string[]
  caseNumbers: string[]
}

// ---------- 案件 ----------
export interface CaseInfo {
  id: string
  case_number: string
  title: string
  case_type: string
  case_status: string
  court: string
  client: string
  opponent: string
  filing_date: string
  description: string
  volume_order: string | null
  created_at: string
  updated_at: string
}

export interface CaseParty {
  id: string
  caseId: string
  name: string
  role: string
  type: string
  contact: string
  notes: string
}

// ---------- AI ----------
/** 发送给 LLM 的单条消息（无需前端字段） */
export interface LlmMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatMessage extends LlmMessage {
  timestamp: string
  tokenCount?: number
}

/** RAG 检索来源（law_id 非空时可跳转法规条款） */
export interface RagSource {
  id: string
  source_type: string
  title: string
  snippet: string
  law_id: string | null
  article_id: string | null
}

export interface RagResult {
  answer: string
  sources: RagSource[]
  usage?: { prompt_tokens: number; completion_tokens: number }
}

export interface ConversationRow {
  id: string
  title: string | null
  conv_type: string
  messages: string
  model: string | null
  total_tokens: number
  created_at: string
  updated_at: string
}

export interface UsageStats {
  calls: number
  total_prompt_tokens: number
  total_completion_tokens: number
}

export interface KnowledgeStatus {
  doc_count: number
  ok: boolean
  error?: string
}

export interface KnowledgeRebuildResult {
  ok?: boolean
  doc_count: number
  law_count?: number
  material_count?: number
  message: string
}

export interface SWOTResult {
  strengths: string[]
  weaknesses: string[]
  opportunities: string[]
  threats: string[]
  analysis: string
  timelines?: Array<{ date?: string; event?: string; importance?: string }>
  parties?: Array<{ name?: string; role?: string }>
  dispute_focus?: string[]
  matched_laws?: Array<{ title?: string; article?: string; relevance?: string }>
  suggestions?: string[]
  _related_laws?: Array<{ title?: string; text?: string; law_id?: string | null; article_id?: string | null }>
}

// ---------- 通用 ----------
export interface ImportResult {
  success: boolean
  imported: number
  skipped: number
  errors: string[]
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// ---------- Preload API 接口 ----------
export interface LawPilotAPI {
  system: {
    ping(): Promise<string>
    dbStatus(): Promise<DbStatus>
    getConfig(key: string): Promise<string>
    setConfig(key: string, value: string): Promise<void>
    pythonStatus(): Promise<PythonStatus>
  }
  law: {
    search(query: string, limit?: number): Promise<SearchResult[]>
    list(params?: LawSearchFilters): Promise<{ items: LawSearchResult[]; total: number }>
    count(): Promise<number>
    getById(id: string): Promise<LawDetail | null>
    import(files: string[]): Promise<ImportResult>
    onImportProgress(callback: (data: { current: number; total: number; fileName: string }) => void): () => void
    export(ids: string[], format: 'pdf' | 'docx'): Promise<string>
    compare(id1: string, id2: string): Promise<CompareResult>
    getRevisions(lawId: string): Promise<Revision[]>
    addRevision(data: { lawId: string; versionTag: string; changeLog?: string; fullText: string }): Promise<Revision>
    getRevision(revisionId: string): Promise<Revision | null>
  }
  case: {
    list(filters?: { case_type?: string; case_status?: string }): Promise<CaseInfo[]>
    count(): Promise<number>
    get(id: string): Promise<CaseInfo | undefined>
    create(data: Partial<CaseInfo>): Promise<CaseInfo>
    update(id: string, data: Partial<CaseInfo>): Promise<CaseInfo>
    delete(id: string): Promise<void>
    exportCase(data: { caseId: string; format: string; savePath: string }): Promise<string | null>
    getActivities(caseId: string): Promise<ActivityRow[]>
  }
  material: {
    import(filePaths: string[]): Promise<Array<{ material: MaterialRow | null; error?: string }>>
    get(id: string): Promise<MaterialRow | null>
    listByCase(caseId: string): Promise<MaterialRow[]>
    linkToCase(materialId: string, caseId: string): Promise<void>
    classify(materialId: string): Promise<{ category: string; confidence: number }>
    latest(limit?: number): Promise<MaterialRow[]>
    delete(id: string): Promise<void>
    updateOrder(caseId: string, orderedIds: string[]): Promise<void>
    updateEvidence(materialId: string, evidenceNo: string, proofPurpose: string): Promise<void>
    onProcessed(callback: (data: { materialId: string; status: string; category?: string; error?: string; suggestedCaseNumber?: string }) => void): () => void
  }
  ai: {
    chat(convId: string, messages: LlmMessage[]): Promise<string>
    onStreamChunk(callback: (chunk: string) => void): () => void
    offStreamChunk(): void
    ragQuery(query: string, context?: string): Promise<RagResult>
    generateReport(template: string, data: unknown): Promise<string>
    swotAnalysis(facts: string): Promise<SWOTResult>
    createConversation(title?: string, convType?: string): Promise<ConversationRow>
    listConversations(): Promise<ConversationRow[]>
    saveMessage(convId: string, messagesJson: string, tokens: number): Promise<void>
    deleteConversation(convId: string): Promise<void>
    usageStats(period: 'today' | 'week' | 'month'): Promise<UsageStats>
    privacyPreview(text: string, level?: string): Promise<{ ok: boolean; preview?: Array<{ original: string; placeholder: string }>; message?: string }>
  }
  knowledge: {
    status(): Promise<KnowledgeStatus>
    rebuild(): Promise<KnowledgeRebuildResult>
  }
  file: {
    select(options?: { filters?: { name: string; extensions: string[] }[] }): Promise<string[] | null>
    getInfo(filePath: string): Promise<{ name: string; size: number; hash: string }>
    readImage(filePath: string): Promise<string | null>
    getPathForFile(file: File): string
  }
}
