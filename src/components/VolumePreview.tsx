import { useState, useEffect, useCallback } from 'react'
import { Typography, Tag, Button, Empty, Spin, Tooltip, message, Progress } from 'antd'
import { formatDateTime } from '../utils/dateFormat'
import {
  MenuOutlined,
  LeftOutlined,
  RightOutlined,
  SaveOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import type { MaterialRow, CaseInfo } from '../../shared/types'
import { EntityTags } from './EntityTags'
import { Markdown } from './Markdown'
import { extractEntities } from '../utils/entityExtractor'

const { Title, Text } = Typography

// 默认排序：程序文书 → 起诉状/答辩状 → 证据 → 判决/裁定 → 合同 → 其他
const CATEGORY_ORDER = ['起诉状', '答辩状', '证据', '判决', '裁定', '合同', '其他']

const CATEGORY_COLORS: Record<string, string> = {
  '起诉状': 'blue',
  '答辩状': 'orange',
  '证据': 'purple',
  '判决': 'red',
  '裁定': 'cyan',
  '合同': 'gold',
  '其他': 'default',
}

interface Props {
  caseInfo: CaseInfo
  materials: MaterialRow[]
  onOrderSaved: () => void
}

export function VolumePreview({ caseInfo, materials, onOrderSaved }: Props) {
  const [orderedIds, setOrderedIds] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // 初始化排序：优先用已保存的 volume_order，否则用默认分类排序
  useEffect(() => {
    if (materials.length === 0) return

    let savedOrder: string[] = []
    if (caseInfo.volume_order) {
      try {
        savedOrder = JSON.parse(caseInfo.volume_order)
      } catch { /* ignore */ }
    }

    // 合并：已保存的顺序 + 新材料的默认排序
    const materialIdSet = new Set(materials.map((m) => m.id))
    const validSaved = savedOrder.filter((id) => materialIdSet.has(id))
    const newIds = materials
      .filter((m) => !validSaved.includes(m.id))
      .sort((a, b) => {
        const ia = CATEGORY_ORDER.indexOf(a.category)
        const ib = CATEGORY_ORDER.indexOf(b.category)
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      })
      .map((m) => m.id)

    const finalOrder = [...validSaved, ...newIds]
    setOrderedIds(finalOrder)
    if (!selectedId || !finalOrder.includes(selectedId)) {
      setSelectedId(finalOrder[0] || null)
    }
  }, [materials, caseInfo.volume_order])

  // 根据 ID 查找材料
  const getMaterial = useCallback(
    (id: string) => materials.find((m) => m.id === id),
    [materials]
  )

  const selectedMaterial = selectedId ? getMaterial(selectedId) : null

  // 拖拽排序
  function handleDragStart(e: React.DragEvent, idx: number) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIdx(idx)
  }

  function handleDragLeave() {
    setDragOverIdx(null)
  }

  function handleDrop(e: React.DragEvent, toIdx: number) {
    e.preventDefault()
    setDragOverIdx(null)
    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10)
    if (fromIdx === toIdx || isNaN(fromIdx)) return

    const newOrder = [...orderedIds]
    const [moved] = newOrder.splice(fromIdx, 1)
    newOrder.splice(toIdx, 0, moved)
    setOrderedIds(newOrder)
  }

  // 保存排序
  async function handleSaveOrder() {
    setSaving(true)
    try {
      await window.api.material.updateOrder(caseInfo.id, orderedIds)
      message.success('卷宗排序已保存')
      onOrderSaved()
    } catch (err) {
      message.error(`保存失败: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  // 上下移动
  function moveItem(idx: number, direction: -1 | 1) {
    const newIdx = idx + direction
    if (newIdx < 0 || newIdx >= orderedIds.length) return
    const newOrder = [...orderedIds]
    ;[newOrder[idx], newOrder[newIdx]] = [newOrder[newIdx], newOrder[idx]]
    setOrderedIds(newOrder)
  }

  if (materials.length === 0) {
    return <Empty description="暂无材料，请先上传材料后再查看卷宗" />
  }

  return (
    <div>
      {/* 工具栏 */}
      <div className="flex items-center justify-between mb-3">
        <Text strong>
          卷宗目录 · 共 {orderedIds.length} 份材料
        </Text>
        <Button
          icon={<SaveOutlined />}
          type="primary"
          size="small"
          loading={saving}
          onClick={handleSaveOrder}
        >
          保存排序
        </Button>
      </div>

      <div className="flex gap-3" style={{ minHeight: 400 }}>
        {/* 左侧目录 */}
        <div
          className="border rounded-lg overflow-auto flex-shrink-0"
          style={{ width: 320, maxHeight: 'calc(100vh - 300px)' }}
        >
          <div className="bg-gray-50 px-3 py-2 border-b text-xs text-gray-500 font-medium">
            目录（拖拽排序）
          </div>
          {orderedIds.map((id, idx) => {
            const m = getMaterial(id)
            if (!m) return null
            const isSelected = selectedId === id

            return (
              <div
                key={id}
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, idx)}
                onClick={() => setSelectedId(id)}
                className={`
                  flex items-center gap-2 px-3 py-2 cursor-pointer border-b transition-colors
                  ${isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50'}
                  ${dragOverIdx === idx ? 'border-t-2 border-t-blue-400' : ''}
                `}
              >
                {/* 序号 */}
                <Text
                  className="flex-shrink-0 text-center"
                  style={{ width: 28, color: isSelected ? '#1677ff' : '#999' }}
                >
                  {String(idx + 1).padStart(2, '0')}
                </Text>

                {/* 拖拽手柄 */}
                <MenuOutlined className="text-gray-300 flex-shrink-0 text-xs cursor-grab" />

                {/* 文件信息 */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate font-medium flex items-center gap-1">
                    {m.original_name}
                    {m.ocr_status === 'processing' && (
                      <LoadingOutlined className="text-blue-400 text-xs flex-shrink-0" />
                    )}
                    {m.ocr_status === 'done' && m.raw_text && (
                      <CheckCircleOutlined className="text-green-400 text-xs flex-shrink-0" />
                    )}
                    {m.ocr_status === 'error' && (
                      <CloseCircleOutlined className="text-red-400 text-xs flex-shrink-0" />
                    )}
                    {m.ocr_status === 'pending' && (
                      <ClockCircleOutlined className="text-gray-300 text-xs flex-shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Tag
                      color={CATEGORY_COLORS[m.category] || 'default'}
                      className="text-xs leading-none"
                      style={{ margin: 0, padding: '0 4px', fontSize: 10 }}
                    >
                      {m.category}
                    </Tag>
                    <Text className="text-xs" style={{ color: '#bbb' }}>
                      {m.file_size ? `${(m.file_size / 1024).toFixed(0)}KB` : ''}
                    </Text>
                  </div>
                </div>

                {/* 上下移动按钮 */}
                <div className="flex flex-col gap-0.5 flex-shrink-0">
                  <Tooltip title="上移">
                    <Button
                      type="text"
                      size="small"
                      disabled={idx === 0}
                      icon={<LeftOutlined className="rotate-90" style={{ fontSize: 10 }} />}
                      onClick={(e) => { e.stopPropagation(); moveItem(idx, -1) }}
                      style={{ height: 16, padding: 0, lineHeight: 1 }}
                    />
                  </Tooltip>
                  <Tooltip title="下移">
                    <Button
                      type="text"
                      size="small"
                      disabled={idx === orderedIds.length - 1}
                      icon={<RightOutlined className="rotate-90" style={{ fontSize: 10 }} />}
                      onClick={(e) => { e.stopPropagation(); moveItem(idx, 1) }}
                      style={{ height: 16, padding: 0, lineHeight: 1 }}
                    />
                  </Tooltip>
                </div>
              </div>
            )
          })}
        </div>

        {/* 右侧内容预览 */}
        <div className="flex-1 border rounded-lg overflow-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          {selectedMaterial ? (
            <div className="p-4">
              <div className="mb-4">
                <Title level={5} className="!mb-1">
                  {selectedMaterial.original_name}
                </Title>
                <div className="flex gap-2">
                  <Tag color={CATEGORY_COLORS[selectedMaterial.category] || 'default'}>
                    {selectedMaterial.category}
                  </Tag>
                  <Text type="secondary" className="text-sm">
                    {selectedMaterial.file_size
                      ? `${(selectedMaterial.file_size / 1024).toFixed(1)} KB`
                      : '未知大小'}
                    {' · '}
                    {formatDateTime(selectedMaterial.created_at)}
                  </Text>
                </div>
                {selectedMaterial.raw_text && (
                  <EntityTags entities={extractEntities(selectedMaterial.raw_text)} />
                )}
              </div>

              {selectedMaterial.raw_text ? (
                <div className="border rounded p-4 bg-gray-50">
                  <div
                    className="text-sm leading-relaxed"
                    style={{ maxHeight: 'calc(100vh - 450px)', overflow: 'auto' }}
                  >
                    <Markdown>{selectedMaterial.raw_text}</Markdown>
                  </div>
                </div>
              ) : selectedMaterial.ocr_status === 'processing' ? (
                <div className="text-center py-16">
                  <Spin indicator={<LoadingOutlined style={{ fontSize: 32 }} spin />} />
                  <div className="mt-4 text-gray-500">正在提取文本，请稍候...</div>
                  <Progress
                    percent={99}
                    status="active"
                    showInfo={false}
                    className="mt-4"
                    style={{ maxWidth: 300, margin: '0 auto' }}
                  />
                </div>
              ) : (
                <div className="text-center py-16 text-gray-400">
                  {selectedMaterial.ocr_status === 'error'
                    ? `文本提取失败: ${selectedMaterial.ocr_error || '未知错误'}`
                    : '暂无文本内容'}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              请从左侧目录选择材料查看
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
