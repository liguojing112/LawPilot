import { useState, useRef, useCallback, useEffect } from 'react'
import { Button, List, Tag, Typography, Progress, Select, message } from 'antd'
import {
  InboxOutlined,
  FilePdfOutlined,
  FileImageOutlined,
  FileWordOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons'
import type { MaterialRow, CaseInfo } from '../../shared/types'

const { Text } = Typography

interface FileItem {
  id: string
  name: string
  /** Electron 渲染进程中 File 携带的完整路径，拖拽导入时传给主进程 */
  path?: string
  size: number
  status: 'pending' | 'processing' | 'done' | 'error'
  error?: string
  category?: string
  caseId?: string
  suggestedCaseNumber?: string
}

interface Props {
  /** 已有的案件列表（用于关联下拉） */
  cases?: CaseInfo[]
  /** 材料处理完成回调 */
  onMaterialProcessed?: (item: MaterialRow) => void
  /** 页面作用域的 localStorage key，用于切换页面后恢复文件列表（避免跨页面串场） */
  storageKey?: string
  /**
   * 挂载时把已恢复的"完成"材料重新回调给父组件（从 DB 读取最新行）。
   * 供尽调页这类需要"材料文本池"的页面使用：切走再回来时文本池是内存态会清空，
   * 但文件列表恢复了，不重放就会出现"文件显示完成、文本却是空的"。
   * 案件列表/详情等回调有副作用的页面不要开（会重复跳转/重复关联）。
   */
  restoreProcessed?: boolean
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'pdf': return <FilePdfOutlined className="text-red-500 text-lg" />
    case 'png': case 'jpg': case 'jpeg': case 'tiff': case 'tif': return <FileImageOutlined className="text-blue-500 text-lg" />
    case 'doc': case 'docx': return <FileWordOutlined className="text-blue-700 text-lg" />
    default: return <FileTextOutlined className="text-gray-500 text-lg" />
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileDropZone({ cases = [], onMaterialProcessed, storageKey, restoreProcessed = false }: Props) {
  const [files, setFiles] = useState<FileItem[]>(() => {
    if (!storageKey) return []
    try {
      const saved = localStorage.getItem(storageKey)
      return saved ? (JSON.parse(saved) as FileItem[]) : []
    } catch {
      return []
    }
  })
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const dragCounter = useRef(0)

  // 持久化文件列表：切换页面后恢复，且跨页面不串场
  useEffect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(files))
    } catch {
      // localStorage 超出或不可用时静默忽略
    }
  }, [files, storageKey])

  // 挂载时同步恢复的文件真实状态（切走时若正在处理，回来应更新为实际结果）
  // restoreProcessed 时，把已完成的材料从 DB 重新回调给父组件（文本池类页面切走再回来不丢文本）
  useEffect(() => {
    if (!storageKey || files.length === 0) return
    let cancelled = false
    const syncIds = files.filter((f) => f.status === 'processing' || f.status === 'pending').map((f) => f.id)
    const restoreIds = restoreProcessed
      ? files.filter((f) => f.status === 'done' && !f.id.startsWith('temp_')).map((f) => f.id)
      : []
    if (syncIds.length === 0 && restoreIds.length === 0) return
    ;(async () => {
      const updates: Record<string, { status: FileItem['status']; category?: string; error?: string }> = {}
      for (const id of syncIds) {
        try {
          const m = await window.api.material.get(id)
          if (m) {
            updates[id] = {
              status: m.ocr_status === 'done' ? 'done' : m.ocr_status === 'error' ? 'error' : 'processing',
              category: m.category,
              error: m.ocr_error || undefined,
            }
          }
        } catch {
          // 忽略单个查询失败
        }
      }
      if (cancelled) return
      setFiles((prev) =>
        prev.map((f) => (updates[f.id] ? { ...f, ...updates[f.id] } : f))
      )
      for (const id of restoreIds) {
        try {
          const m = await window.api.material.get(id)
          if (m && m.ocr_status === 'done' && m.raw_text) {
            onMaterialProcessed?.(m)
          }
        } catch {
          // 忽略单个查询失败
        }
      }
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const allowedExts = ['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.doc', '.docx', '.txt', '.md']

  function isAllowed(name: string): boolean {
    const ext = '.' + (name.split('.').pop()?.toLowerCase() || '')
    return allowedExts.includes(ext)
  }

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    dragCounter.current = 0

    const droppedFiles: FileItem[] = []
    let droppedAny = false
    if (e.dataTransfer.files) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const f = e.dataTransfer.files[i]
        droppedAny = true
        // Electron 32+ 移除了 File.path，需通过 webUtils.getPathForFile 获取真实路径
        const filePath = window.api.file.getPathForFile(f)
        if (filePath && isAllowed(f.name)) {
          droppedFiles.push({
            id: `temp_${Date.now()}_${i}`,
            name: f.name,
            path: filePath,
            size: f.size,
            status: 'pending',
          })
        }
      }
    }

    if (droppedFiles.length > 0) {
      setFiles((prev) => [...prev, ...droppedFiles])
      // 立即启动导入（传完整路径，主进程据此读文件）
      importFiles(droppedFiles.map((f) => f.path!))
    } else if (droppedAny) {
      message.warning('部分文件格式不支持，仅支持 PDF/图片/Word/TXT')
    }
  }, [])

  async function handleClickSelect() {
    const result = await window.api.file.select({
      filters: [{ name: '法律文书', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif', 'doc', 'docx', 'txt', 'md'] }],
    })
    if (!result || result.length === 0) return

    const newFiles: FileItem[] = result.map((path, i) => {
      const name = path.split(/[\\/]/).pop() || path
      return { id: `temp_sel_${Date.now()}_${i}`, name, path, size: 0, status: 'pending' }
    })
    setFiles((prev) => [...prev, ...newFiles])
    await importFiles(result)
  }

  async function importFiles(filePaths: string[]) {
    if (filePaths.length === 0) return
    setImporting(true)

    // 仅把本批次的 pending 项标记为处理中
    const batchPaths = new Set(filePaths)
    setFiles((prev) =>
      prev.map((f) =>
        f.status === 'pending' && f.path && batchPaths.has(f.path)
          ? { ...f, status: 'processing' as const }
          : f
      )
    )

    try {
      // 主进程按输入顺序返回结果：results[i] ↔ filePaths[i]
      const results = await window.api.material.import(filePaths)

      // 路径 → results 下标队列（兼容同批次重复路径）
      const indicesByPath = new Map<string, number[]>()
      filePaths.forEach((p, idx) => {
        const list = indicesByPath.get(p) || []
        list.push(idx)
        indicesByPath.set(p, list)
      })
      const cursor = new Map<string, number>()

      setFiles((prev) =>
        prev.map((f) => {
          // 按完整路径匹配（同名文件、特殊文件名均可靠）
          if (!f.path) return f
          const list = indicesByPath.get(f.path)
          if (!list || list.length === 0) return f
          const used = cursor.get(f.path) || 0
          if (used >= list.length) return f
          cursor.set(f.path, used + 1)

          const r = results[list[used]]
          if (!r) return f
          if (r.material) {
            // 通知父组件材料已导入，触发自动关联案件等操作
            onMaterialProcessed?.(r.material)
            return {
              ...f,
              id: r.material.id,
              status: 'done' as const,
              category: r.material.category,
            }
          }
          return { ...f, status: 'error' as const, error: r.error }
        })
      )
    } catch (err) {
      message.error(`导入失败: ${(err as Error).message}`)
      setFiles((prev) =>
        prev.map((f) =>
          f.status === 'processing' ? { ...f, status: 'error' as const, error: (err as Error).message } : f
        )
      )
    } finally {
      setImporting(false)
    }
  }

  async function handleLinkCase(materialId: string, caseId: string) {
    // AntD Select 清空时 onChange 会回调 undefined，此时视为"取消关联"
    if (!caseId) {
      message.info('已取消关联')
      return
    }
    try {
      // 若 item.id 为临时 id（导入时未匹配到），先按原始文件名反查真实材料
      let realId = materialId
      if (materialId.startsWith('temp_')) {
        const latest = await window.api.material.latest(100)
        const matched = latest.find((m) => m.original_name === files.find((f) => f.id === materialId)?.name)
        if (!matched) throw new Error('未找到对应的材料记录，请重新上传')
        realId = matched.id
      }
      await window.api.material.linkToCase(realId, caseId)
      // 回写状态并让父组件刷新
      setFiles((prev) => prev.map((f) => (f.id === materialId ? { ...f, id: realId, caseId } : f)))
      message.success('已关联到案件')
    } catch (err) {
      message.error(`关联失败: ${(err as Error).message}`)
    }
  }

  const completedCount = files.filter((f) => f.status === 'done').length
  const errorCount = files.filter((f) => f.status === 'error').length

  return (
    <div className="mb-4">
      {/* 拖拽区域 */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
          dragging
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-300 hover:border-blue-300 hover:bg-gray-50'
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClickSelect}
      >
        <InboxOutlined className="text-5xl text-gray-400 mb-4" />
        <p className="text-gray-500 text-lg mb-1">拖拽文件到此处，或点击选择</p>
        <p className="text-gray-400 text-sm">
          支持 PDF、图片（PNG/JPG/TIFF）、Word（DOC/DOCX）、TXT
        </p>
      </div>

      {/* 文件列表 */}
      {files.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <Text strong>
              文件列表 ({files.length}) — 完成 {completedCount}
              {errorCount > 0 && ` / 失败 ${errorCount}`}
            </Text>
            <Button size="small" onClick={() => setFiles([])}>
              清空
            </Button>
          </div>

          <List
            size="small"
            dataSource={files}
            renderItem={(item) => (
              <List.Item
                actions={[
                  item.status === 'done' && cases.length > 0 && (
                    <Select
                      key="link"
                      size="small"
                      placeholder="关联案件"
                      style={{ width: 180 }}
                      onChange={(caseId: string) => handleLinkCase(item.id, caseId)}
                      options={cases.map((c) => ({
                        value: c.id,
                        label: `${c.case_number || ''} ${c.title}`,
                      }))}
                      allowClear
                    />
                  ),
                  item.suggestedCaseNumber && (
                    <Tag key="suggest" color="blue">
                      案号: {item.suggestedCaseNumber}
                    </Tag>
                  ),
                ]}
              >
                <List.Item.Meta
                  avatar={
                    item.status === 'processing' ? (
                      <LoadingOutlined className="text-blue-500" />
                    ) : item.status === 'done' ? (
                      <CheckCircleOutlined className="text-green-500" />
                    ) : item.status === 'error' ? (
                      <CloseCircleOutlined className="text-red-500" />
                    ) : (
                      <ExclamationCircleOutlined className="text-orange-400" />
                    )
                  }
                  title={
                    <span className="flex items-center gap-2">
                      {getFileIcon(item.name)}
                      <span>{item.name}</span>
                      {item.size > 0 && (
                        <Text type="secondary" className="text-xs">
                          {formatSize(item.size)}
                        </Text>
                      )}
                      {item.category && item.category !== '其他' && (
                        <Tag color="green" className="text-xs">
                          {item.category}
                        </Tag>
                      )}
                    </span>
                  }
                  description={
                    item.status === 'error'
                      ? <Text type="danger" className="text-xs">{item.error}</Text>
                      : item.status === 'processing'
                        ? <Text type="secondary" className="text-xs">正在处理...</Text>
                        : undefined
                  }
                />
              </List.Item>
            )}
          />
        </div>
      )}
    </div>
  )
}
