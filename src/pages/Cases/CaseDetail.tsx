import { useState, useEffect } from 'react'
import {
  Tabs, Descriptions, Tag, Card, Typography, List, Timeline, Button, Spin, Empty, Space,
  Modal, Form, Input, Select, DatePicker, message,
} from 'antd'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeftOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ClockCircleOutlined,
  BookOutlined,
  EditOutlined,
  ExportOutlined,
  FilePdfOutlined,
  FileZipOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { FileDropZone } from '../../components/FileDropZone'
import { VolumePreview } from '../../components/VolumePreview'
import { EntityTags } from '../../components/EntityTags'
import { extractEntities } from '../../utils/entityExtractor'
import type { ExtractedEntities } from '../../utils/entityExtractor'
import { formatDateTime } from '../../utils/dateFormat'
import type { CaseInfo, MaterialRow, ActivityRow } from '../../../shared/types'

const { Title, Text } = Typography

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  active: { color: 'blue', label: '办理中' },
  closed: { color: 'green', label: '已结案' },
  archived: { color: 'default', label: '已归档' },
}

const CASE_TYPES = ['民事', '刑事', '行政', '执行', '非诉']
const CASE_STATUS_OPTIONS = [
  { value: 'active', label: '办理中' },
  { value: 'closed', label: '已结案' },
  { value: 'archived', label: '已归档' },
]

const CATEGORY_COLORS: Record<string, string> = {
  '起诉状': 'blue',
  '答辩状': 'orange',
  '证据': 'purple',
  '判决': 'red',
  '裁定': 'cyan',
  '合同': 'gold',
  '其他': 'default',
}

export function CaseDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [caseInfo, setCaseInfo] = useState<CaseInfo | null>(null)
  const [materials, setMaterials] = useState<MaterialRow[]>([])
  const [activities, setActivities] = useState<ActivityRow[]>([])
  const [allCases, setAllCases] = useState<CaseInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('materials')
  const [aiEntities, setAiEntities] = useState<Record<string, ExtractedEntities | null>>({})
  const [extractingId, setExtractingId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editForm] = Form.useForm()
  const [preview, setPreview] = useState<{ material: MaterialRow; image?: string } | null>(null)
  const [evidenceEdit, setEvidenceEdit] = useState<MaterialRow | null>(null)
  const [evidenceSaving, setEvidenceSaving] = useState(false)
  const [evidenceForm] = Form.useForm()

  useEffect(() => {
    if (!id) return
    loadData()

    // 监听材料处理完成事件，自动刷新列表
    const unsub = window.api.material.onProcessed((_data) => {
      loadData()
    })
    return () => { unsub() }
  }, [id])

  async function loadData() {
    setLoading(true)
    try {
      const [c, mats, acts, all] = await Promise.all([
        window.api.case.get(id!),
        window.api.material.listByCase(id!),
        window.api.case.getActivities(id!),
        window.api.case.list({}),
      ])
      setCaseInfo(c || null)
      setMaterials(mats || [])
      setActivities(acts || [])
      setAllCases(all || [])

      // 恢复之前 AI 提取的实体
      const savedEntities: Record<string, ExtractedEntities> = {}
      for (const m of mats || []) {
        try {
          const raw = await window.api.system.getConfig(`material.ai.${m.id}`)
          if (raw) savedEntities[m.id] = JSON.parse(raw)
        } catch { /* 无缓存 */ }
      }
      setAiEntities((prev) => ({ ...prev, ...savedEntities }))
    } catch (err) {
      console.error('加载案件详情失败:', err)
    } finally {
      setLoading(false)
    }
  }

  function handleMaterialProcessed(m: MaterialRow) {
    // 自动关联到当前案件
    window.api.material.linkToCase(m.id, id!).then(() => loadData())
  }

  async function handleExport(format: 'pdf' | 'zip') {
    if (!id) return
    try {
      const savedPath = await window.api.case.exportCase({ caseId: id, format, savePath: '' })
      // 用户在保存对话框中取消时，主进程返回 null，不提示成功
      if (savedPath) {
        message.success(`已导出 ${format.toUpperCase()}：${savedPath}`)
      }
    } catch (err) {
      message.error(`导出失败: ${(err as Error).message}`)
    }
  }

  async function handleAIExtract(materialId: string, rawText: string) {
    setExtractingId(materialId)
    try {
      const status = await window.api.system.pythonStatus()
      if (!status.running) {
        message.error('Python 服务未启动，无法使用 AI 提取')
        return
      }
      const resp = await fetch(`http://127.0.0.1:${status.port}/llm/extract-entities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawText }),
      })
      const data = await resp.json()
      if (data.ok) {
        setAiEntities((prev) => ({ ...prev, [materialId]: data }))
        // 持久化到数据库
        await window.api.system.setConfig(`material.ai.${materialId}`, JSON.stringify(data))
        message.success('AI 提取完成')
      } else {
        message.error(data.message || 'AI 提取失败')
      }
    } catch (err) {
      message.error(`AI 提取失败: ${(err as Error).message}`)
    } finally {
      setExtractingId(null)
    }
  }

  // ---- 证据编号/证明目的编辑 ----
  function openEvidenceEdit(material: MaterialRow): void {
    setEvidenceEdit(material)
    evidenceForm.setFieldsValue({
      evidence_no: material.evidence_no || '',
      proof_purpose: material.proof_purpose || '',
    })
  }

  async function handleEvidenceSave(): Promise<void> {
    if (!evidenceEdit) return
    try {
      const values = await evidenceForm.validateFields()
      setEvidenceSaving(true)
      await window.api.material.updateEvidence(
        evidenceEdit.id,
        values.evidence_no || '',
        values.proof_purpose || ''
      )
      message.success('证据信息已保存')
      setEvidenceEdit(null)
      loadData()
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return
      message.error(`保存失败: ${(err as Error).message}`)
    } finally {
      setEvidenceSaving(false)
    }
  }

  function openEdit(): void {
    if (!caseInfo) return
    editForm.setFieldsValue({
      title: caseInfo.title,
      case_number: caseInfo.case_number,
      case_type: caseInfo.case_type,
      case_status: caseInfo.case_status,
      court: caseInfo.court,
      client: caseInfo.client,
      opponent: caseInfo.opponent,
      filing_date: caseInfo.filing_date ? dayjs(caseInfo.filing_date) : undefined,
      description: caseInfo.description,
    })
    setEditOpen(true)
  }

  async function handleEditSave(): Promise<void> {
    try {
      const values = await editForm.validateFields()
      setEditSaving(true)
      await window.api.case.update(id!, {
        ...values,
        filing_date: values.filing_date ? values.filing_date.format('YYYY-MM-DD') : null,
      })
      setEditOpen(false)
      message.success('案件信息已更新')
      loadData()
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return
      message.error(`更新失败: ${(err as Error).message}`)
    } finally {
      setEditSaving(false)
    }
  }

  async function handlePreview(item: MaterialRow) {
    if ((item.mime_type || '').startsWith('image/')) {
      const image = await window.api.file.readImage(item.stored_path)
      setPreview({ material: item, image: image || undefined })
    } else {
      setPreview({ material: item })
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spin size="large" />
      </div>
    )
  }

  if (!caseInfo) {
    return <Empty description="未找到该案件" />
  }

  const status = STATUS_MAP[caseInfo.case_status] || { color: 'default', label: caseInfo.case_status }

  // 材料排序（按默认规则：起诉状→答辩状→证据→判决→其他）
  function sortMaterials(items: MaterialRow[]): MaterialRow[] {
    const order = ['起诉状', '答辩状', '证据', '判决', '裁定', '合同', '其他']
    return [...items].sort((a, b) => {
      const ia = order.indexOf(a.category)
      const ib = order.indexOf(b.category)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
  }

  const sortedMaterials = sortMaterials(materials)

  const tabItems = [
    {
      key: 'materials',
      label: `材料 (${materials.length})`,
      children: (
        <div>
          <FileDropZone
            cases={allCases}
            onMaterialProcessed={handleMaterialProcessed}
          />

          <div className="mt-4">
            <Title level={5}>已关联材料</Title>
            {sortedMaterials.length === 0 ? (
              <Empty description="暂无材料，请拖拽文件到上方区域上传" />
            ) : (
              <List
                size="small"
                dataSource={sortedMaterials}
                renderItem={(item) => (
                  <List.Item
                    actions={[
                      item.ocr_status === 'done' && (
                        <Button key="view" type="link" size="small" onClick={() => handlePreview(item)}>
                          预览
                        </Button>
                      ),
                      <Button
                        key="evidence"
                        type="link"
                        size="small"
                        onClick={() => openEvidenceEdit(item)}
                      >
                        编辑证据
                      </Button>,
                      <Button
                        key="unlink"
                        type="link"
                        danger
                        size="small"
                        onClick={async () => {
                          try {
                            await window.api.material.linkToCase(item.id, '')
                            loadData()
                          } catch (err) {
                            console.error('取消关联失败:', err)
                          }
                        }}
                      >
                        取消关联
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={
                        <Space>
                          <span>{item.original_name}</span>
                          <Tag color={CATEGORY_COLORS[item.category] || 'default'}>
                            {item.category}
                          </Tag>
                          <Tag
                            color={
                              item.ocr_status === 'done'
                                ? 'success'
                                : item.ocr_status === 'processing'
                                  ? 'processing'
                                  : item.ocr_status === 'error'
                                    ? 'error'
                                    : 'default'
                            }
                          >
                            {item.ocr_status === 'done' ? '已完成' : item.ocr_status}
                          </Tag>
                        </Space>
                      }
                      description={
                        <div>
                          <div>
                            {item.file_size
                              ? `${(item.file_size / 1024).toFixed(1)} KB · ${formatDateTime(item.created_at)}`
                              : formatDateTime(item.created_at)}
                          </div>
                          {(item.evidence_no || item.proof_purpose) && (
                            <div className="mt-1" style={{ fontSize: 12 }}>
                              <Text type="secondary">
                                {item.evidence_no ? item.evidence_no : ''}
                                {item.proof_purpose ? ` — 证明：${item.proof_purpose}` : ''}
                              </Text>
                            </div>
                          )}
                          {item.raw_text && (
                            <div>
                              <EntityTags
                                entities={extractEntities(item.raw_text)}
                                aiEntities={aiEntities[item.id] || undefined}
                                cases={allCases}
                                onCaseNumberClick={(caseId) => {
                                  window.api.material.linkToCase(item.id, caseId).then(() => loadData())
                                }}
                              />
                              <Button
                                size="small"
                                type="link"
                                icon={<RobotOutlined />}
                                loading={extractingId === item.id}
                                onClick={() => handleAIExtract(item.id, item.raw_text!)}
                                style={{ padding: 0, height: 20, fontSize: 12 }}
                              >
                                AI 智能提取
                              </Button>
                            </div>
                          )}
                        </div>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'volume',
      label: (
        <span>
          <BookOutlined className="mr-1" />
          卷宗预览
        </span>
      ),
      children: (
        <VolumePreview
          caseInfo={caseInfo}
          materials={sortedMaterials}
          onOrderSaved={() => loadData()}
        />
      ),
    },
    {
      key: 'activities',
      label: `动态 (${activities.length})`,
      children: activities.length === 0 ? (
        <Empty description="暂无动态" />
      ) : (
        <Timeline
          items={activities.map((a) => ({
            color: a.action.includes('created') ? 'blue' : a.action.includes('linked') ? 'green' : 'gray',
            children: (
              <div>
                <Text>{a.description}</Text>
                <br />
                <Text type="secondary" className="text-xs">
                  {formatDateTime(a.created_at)}
                </Text>
              </div>
            ),
          }))}
        />
      ),
    },
  ]

  return (
    <div>
      <Button
        icon={<ArrowLeftOutlined />}
        type="link"
        onClick={() => navigate('/cases')}
        className="!p-0 mb-4"
      >
        返回案件列表
      </Button>

      <Card className="mb-4">
        <div className="flex items-center justify-between mb-4">
          <Title level={3} className="!mb-0">
            {caseInfo.case_number ? `${caseInfo.case_number} — ` : ''}
            {caseInfo.title}
          </Title>
          <Space>
            <Button icon={<EditOutlined />} onClick={openEdit}>
              编辑案件
            </Button>
            <Button icon={<FilePdfOutlined />} onClick={() => handleExport('pdf')}>
              导出 PDF
            </Button>
            <Button icon={<FileZipOutlined />} onClick={() => handleExport('zip')}>
              导出 ZIP
            </Button>
          </Space>
        </div>
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="案件类型">
            <Tag>{caseInfo.case_type}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={status.color}>{status.label}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="管辖法院">{caseInfo.court || '-'}</Descriptions.Item>
          <Descriptions.Item label="委托人">{caseInfo.client || '-'}</Descriptions.Item>
          <Descriptions.Item label="对方当事人">{caseInfo.opponent || '-'}</Descriptions.Item>
          <Descriptions.Item label="立案日期">{caseInfo.filing_date || '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {formatDateTime(caseInfo.created_at)}
          </Descriptions.Item>
          <Descriptions.Item label="最后更新">
            {formatDateTime(caseInfo.updated_at)}
          </Descriptions.Item>
          {caseInfo.description && (
            <Descriptions.Item label="案情描述" span={2}>
              {caseInfo.description}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      <Card>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
        />
      </Card>

      <Modal
        title="编辑案件"
        open={editOpen}
        onOk={handleEditSave}
        confirmLoading={editSaving}
        onCancel={() => setEditOpen(false)}
        okText="保存"
        cancelText="取消"
        width={560}
      >
        <Form form={editForm} layout="vertical" className="mt-4">
          <Form.Item
            name="title"
            label="案由/名称"
            rules={[{ required: true, message: '请输入案由或案件名称' }]}
          >
            <Input placeholder="如：张三与李四合同纠纷案" />
          </Form.Item>

          <Space size="middle">
            <Form.Item name="case_number" label="案号" style={{ width: 260 }}>
              <Input placeholder="如：(2024)京0105民初12345号" />
            </Form.Item>

            <Form.Item
              name="case_type"
              label="案件类型"
              rules={[{ required: true, message: '请选择案件类型' }]}
              style={{ width: 180 }}
            >
              <Select options={CASE_TYPES.map((t) => ({ value: t, label: t }))} />
            </Form.Item>
          </Space>

          <Form.Item
            name="case_status"
            label="案件状态"
            rules={[{ required: true, message: '请选择案件状态' }]}
          >
            <Select options={CASE_STATUS_OPTIONS} />
          </Form.Item>

          <Form.Item name="court" label="管辖法院">
            <Input placeholder="如：北京市朝阳区人民法院" />
          </Form.Item>

          <Form.Item name="client" label="委托人">
            <Input placeholder="委托人姓名或单位名称（可选）" />
          </Form.Item>

          <Form.Item name="opponent" label="对方当事人">
            <Input placeholder="对方当事人姓名或单位名称（可选）" />
          </Form.Item>

          <Form.Item name="filing_date" label="立案日期">
            <DatePicker style={{ width: '100%' }} placeholder="选择日期" />
          </Form.Item>

          <Form.Item name="description" label="案情描述">
            <Input.TextArea rows={3} placeholder="简要案情描述（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑证据信息"
        open={!!evidenceEdit}
        onOk={handleEvidenceSave}
        onCancel={() => setEvidenceEdit(null)}
        okText="保存"
        cancelText="取消"
        confirmLoading={evidenceSaving}
      >
        <Form form={evidenceForm} layout="vertical">
          <Form.Item name="evidence_no" label="证据编号">
            <Input placeholder="如：证据一 / 证据1 / E-01" />
          </Form.Item>
          <Form.Item name="proof_purpose" label="证明目的">
            <Input.TextArea rows={3} placeholder="说明该材料要证明的事实，如：证明借贷关系成立" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={preview ? `材料预览：${preview.material.original_name}` : '材料预览'}
        open={!!preview}
        onCancel={() => setPreview(null)}
        footer={null}
        width={860}
      >
        {preview?.image ? (
          <img
            src={preview.image}
            alt={preview.material.original_name}
            style={{ width: '100%', display: 'block' }}
          />
        ) : (
          <div>
            {preview?.material.raw_text ? (
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  fontSize: 13,
                  lineHeight: 1.7,
                  maxHeight: 560,
                  overflow: 'auto',
                  background: '#fafafa',
                  padding: 16,
                  borderRadius: 6,
                }}
              >
                {preview.material.raw_text}
              </pre>
            ) : (
              <Empty
                description={
                  (preview?.material.mime_type || '').startsWith('image/')
                    ? '图片加载失败或文件过大'
                    : '该材料暂无可预览的文本内容'
                }
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
