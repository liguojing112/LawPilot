import { useState, useEffect } from 'react'
import { Select, Button, Card, Typography, Modal, Input, Form, message, Empty } from 'antd'
import { DiffOutlined, PlusOutlined } from '@ant-design/icons'
import { diffLines } from 'diff'
import { formatDate } from '../../utils/dateFormat'
import type { Revision } from '../../../shared/types'

const { Title, Text } = Typography

interface Props {
  lawId: string
  currentContent: string
  revisions: Revision[]
  onRevisionsChange: (revisions: Revision[]) => void
}

export function LawCompare({ lawId, currentContent, revisions, onRevisionsChange }: Props) {
  const [leftId, setLeftId] = useState<string | null>(null)
  const [rightId, setRightId] = useState<string | null>(null)
  const [leftText, setLeftText] = useState('')
  const [rightText, setRightText] = useState('')
  const [diffResult, setDiffResult] = useState<ReturnType<typeof diffLines> | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()

  // 版本选项
  const versionOptions = [
    { value: '__current__', label: '当前版本（库中存储）' },
    ...revisions.map((r) => ({
      value: r.id,
      label: `${r.version_tag} (${formatDate(r.created_at)})`,
    })),
  ]

  useEffect(() => {
    if (leftId && rightId) {
      const l = leftId === '__current__' ? currentContent : revisions.find((r) => r.id === leftId)?.full_text || ''
      const r = rightId === '__current__' ? currentContent : revisions.find((r) => r.id === rightId)?.full_text || ''
      setLeftText(l)
      setRightText(r)
      setDiffResult(diffLines(l, r))
    }
  }, [leftId, rightId, currentContent, revisions])

  async function handleAddRevision() {
    try {
      const values = await form.validateFields()
      const newRev = await window.api.law.addRevision({
        lawId,
        versionTag: values.version_tag,
        changeLog: values.change_log,
        fullText: values.full_text,
      })
      onRevisionsChange([newRev, ...revisions])
      setModalOpen(false)
      form.resetFields()
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return
      console.error('添加版本失败:', err)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <Select
            placeholder="选择版本A"
            value={leftId}
            onChange={setLeftId}
            options={versionOptions}
            style={{ width: 280 }}
          />
          <DiffOutlined className="text-gray-400" />
          <Select
            placeholder="选择版本B"
            value={rightId}
            onChange={setRightId}
            options={versionOptions}
            style={{ width: 280 }}
          />
        </div>
        <Button icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          添加修订版
        </Button>
      </div>

      {diffResult ? (
        <div className="flex gap-0 border rounded" style={{ maxHeight: 'calc(100vh - 400px)', overflow: 'auto' }}>
          {/* 左侧 */}
          <div className="flex-1 border-r">
            <div className="bg-gray-50 px-3 py-1 border-b text-sm font-medium text-gray-500">版本A（旧版）</div>
            <div className="font-mono text-sm leading-relaxed">
              {diffResult.map((part, i) => (
                <div
                  key={i}
                  className={`px-3 py-0.5 whitespace-pre-wrap ${
                    part.removed ? 'bg-red-100 text-red-800' : part.added ? 'hidden' : ''
                  }`}
                >
                  {part.value}
                </div>
              ))}
            </div>
          </div>

          {/* 右侧 */}
          <div className="flex-1">
            <div className="bg-gray-50 px-3 py-1 border-b text-sm font-medium text-gray-500">版本B（新版）</div>
            <div className="font-mono text-sm leading-relaxed">
              {diffResult.map((part, i) => (
                <div
                  key={i}
                  className={`px-3 py-0.5 whitespace-pre-wrap ${
                    part.added ? 'bg-green-100 text-green-800' : part.removed ? 'hidden' : ''
                  }`}
                >
                  {part.value}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <Card className="flex items-center justify-center py-16 text-center">
          <Empty description="请选择两个版本进行对比" />
        </Card>
      )}

      {/* 添加修订版 Modal */}
      <Modal
        title="添加修订版"
        open={modalOpen}
        onOk={handleAddRevision}
        onCancel={() => {
          setModalOpen(false)
          form.resetFields()
        }}
        okText="添加"
        cancelText="取消"
        width={640}
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item
            name="version_tag"
            label="版本标签"
            rules={[{ required: true, message: '请输入版本标签' }]}
          >
            <Input placeholder="如：2020年修订版" />
          </Form.Item>
          <Form.Item name="change_log" label="修订说明">
            <Input placeholder="简要说明修订内容（可选）" />
          </Form.Item>
          <Form.Item
            name="full_text"
            label="全文内容"
            rules={[{ required: true, message: '请输入版本全文' }]}
          >
            <Input.TextArea rows={12} placeholder="粘贴该版本的法规全文..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
