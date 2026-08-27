import { useState, useRef, useCallback } from 'react'
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
  size: number
  status: 'pending' | 'processing' | 'done' | 'error'
  error?: string
  category?: string
  suggestedCaseNumber?: string
}

interface Props {
  /** 已有的案件列表（用于关联下拉） */
  cases?: CaseInfo[]
  /** 材料处理完成回调 */
  onMaterialProcessed?: (item: MaterialRow) => void
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

export function FileDropZone({ cases = [], onMaterialProcessed }: Props) {
  const [files, setFiles] = useState<FileItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const dragCounter = useRef(0)

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
    if (e.dataTransfer.files) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const f = e.dataTransfer.files[i]
        if (f.path && isAllowed(f.name)) {
          droppedFiles.push({
            id: `temp_${Date.now()}_${i}`,
            name: f.name,
            size: f.size,
            status: 'pending',
          })
        }
      }
    }

    if (droppedFiles.length > 0) {
      setFiles((prev) => [...prev, ...droppedFiles])
      // 立即启动导入
      importFiles(droppedFiles.map((f) => f.name))
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
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
      return { id: `temp_sel_${Date.now()}_${i}`, name, size: 0, status: 'pending' }
    })
    setFiles((prev) => [...prev, ...newFiles])
    await importFiles(result)
  }

  async function importFiles(filePaths: string[]) {
    if (filePaths.length === 0) return
    setImporting(true)

    // 标记为处理中
    setFiles((prev) =>
      prev.map((f) =>
        f.status === 'pending' ? { ...f, status: 'processing' as const } : f
      )
    )

    // 监听处理完成事件
    const unsub = window.api.ai.onStreamChunk
      ? () => {} // 占位，实际用 IPC event 监听
      : () => {}

    try {
      const results = await window.api.material.import(filePaths)

      setFiles((prev) =>
        prev.map((f) => {
          // 尝试匹配结果
          const matchName = (r: { material?: { original_name: string } | null }) =>
            r.material?.original_name === f.name
          const idx = results.findIndex(matchName)
          if (idx >= 0 && results[idx]) {
            const r = results[idx]
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
          }
          // 如果找不到精确匹配，保持 processing 直到 MATERIAL_PROCESSED 事件更新
          return f.status === 'processing' ? f : { ...f, status: 'done' as const }
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
    try {
      await window.api.material.linkToCase(materialId, caseId)
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
