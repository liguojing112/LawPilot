import { useState, useEffect } from 'react'
import {
  Table, Button, Modal, Form, Input, Select, DatePicker, Typography, Tag, Space, Card,
} from 'antd'
import { PlusOutlined, FolderOpenOutlined, UnorderedListOutlined, AppstoreOutlined, EditOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { ColumnsType } from 'antd/es/table'
import type { CaseInfo } from '../../../shared/types'
import dayjs from 'dayjs'
import { FileDropZone } from '../../components/FileDropZone'

const { Title, Text } = Typography

const CASE_TYPES = ['民事', '刑事', '行政', '执行', '非诉']

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  active: { color: 'blue', label: '办理中' },
  closed: { color: 'green', label: '已结案' },
  archived: { color: 'default', label: '已归档' },
}

export function CaseList() {
  const navigate = useNavigate()
  const [data, setData] = useState<CaseInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table')
  const [form] = Form.useForm()
  const [editForm] = Form.useForm()
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  async function fetchList(): Promise<void> {
    setLoading(true)
    try {
      const items = await window.api.case.list({})
      setData(items)
    } catch (err) {
      console.error('加载案件列表失败:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchList()
  }, [])

  async function handleCreate(): Promise<void> {
    try {
      const values = await form.validateFields()
      await window.api.case.create({
        ...values,
        filing_date: values.filing_date?.format('YYYY-MM-DD'),
      })
      setModalOpen(false)
      form.resetFields()
      fetchList()
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return // 表单校验失败
      console.error('创建案件失败:', err)
    }
  }

  function openEdit(c: CaseInfo): void {
    setEditingId(c.id)
    editForm.setFieldsValue({
      title: c.title,
      case_number: c.case_number,
      case_type: c.case_type,
      court: c.court,
      client: c.client,
      filing_date: c.filing_date ? dayjs(c.filing_date) : undefined,
      description: c.description,
    })
    setEditModalOpen(true)
  }

  async function handleUpdate(): Promise<void> {
    try {
      const values = await editForm.validateFields()
      await window.api.case.update(editingId!, {
        ...values,
        filing_date: values.filing_date?.format('YYYY-MM-DD'),
      })
      setEditModalOpen(false)
      editForm.resetFields()
      fetchList()
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return
      console.error('更新案件失败:', err)
    }
  }

  const columns: ColumnsType<CaseInfo> = [
    {
      title: '案号',
      dataIndex: 'case_number',
      key: 'case_number',
      render: (t: string) => t || '-',
      width: 200,
    },
    {
      title: '案由/名称',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
    },
    {
      title: '案件类型',
      dataIndex: 'case_type',
      key: 'case_type',
      render: (t: string) => <Tag>{t}</Tag>,
      width: 100,
    },
    {
      title: '管辖法院',
      dataIndex: 'court',
      key: 'court',
      render: (t: string) => t || '-',
      width: 160,
    },
    {
      title: '立案日期',
      dataIndex: 'filing_date',
      key: 'filing_date',
      render: (t: string) => t || '-',
      width: 110,
    },
    {
      title: '状态',
      dataIndex: 'case_status',
      key: 'case_status',
      render: (s: string) => {
        const st = STATUS_MAP[s] || { color: 'default', label: s }
        return <Tag color={st.color}>{st.label}</Tag>
      },
      width: 90,
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          icon={<EditOutlined />}
          onClick={(e) => {
            e.stopPropagation()
            openEdit(record)
          }}
        />
      ),
    },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Title level={3} className="!mb-0">
          <FolderOpenOutlined className="mr-2" />
          案件管理
        </Title>
        <Space>
          <Button
            icon={<UnorderedListOutlined />}
            type={viewMode === 'table' ? 'primary' : 'default'}
            onClick={() => setViewMode('table')}
          />
          <Button
            icon={<AppstoreOutlined />}
            type={viewMode === 'card' ? 'primary' : 'default'}
            onClick={() => setViewMode('card')}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            新建案件
          </Button>
        </Space>
      </div>

      {/* 拖拽上传材料区域 */}
      <FileDropZone
        cases={data}
        onMaterialProcessed={(m) => {
          if (m.case_id) navigate(`/cases/${m.case_id}`)
        }}
      />

      {viewMode === 'table' ? (
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          onRow={(record) => ({
            onClick: () => navigate(`/cases/${record.id}`),
            style: { cursor: 'pointer' },
          })}
          pagination={{ showTotal: (t) => `共 ${t} 个案件` }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.map((c) => {
            const st = STATUS_MAP[c.case_status] || { color: 'default', label: c.case_status }
            return (
              <Card
                key={c.id}
                hoverable
                size="small"
                onClick={() => navigate(`/cases/${c.id}`)}
                title={
                  <Space>
                    <Tag>{c.case_type}</Tag>
                    <Tag color={st.color}>{st.label}</Tag>
                  </Space>
                }
                extra={
                  <Button type="text" size="small" icon={<EditOutlined />}
                    onClick={(e) => { e.stopPropagation(); openEdit(c) }} />
                }
              >
                <Text strong className="block mb-2">{c.title}</Text>
                <div className="text-gray-500 text-xs space-y-1">
                  {c.case_number && <div>案号: {c.case_number}</div>}
                  {c.court && <div>法院: {c.court}</div>}
                  {c.filing_date && <div>立案: {c.filing_date}</div>}
                </div>
              </Card>
            )
          })}
          {data.length === 0 && (
            <div className="col-span-full text-center text-gray-400 py-8">暂无案件</div>
          )}
        </div>
      )}

      <Modal
        title="新建案件"
        open={modalOpen}
        onOk={handleCreate}
        onCancel={() => {
          setModalOpen(false)
          form.resetFields()
        }}
        okText="创建"
        cancelText="取消"
        width={560}
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item
            name="title"
            label="案由/名称"
            rules={[{ required: true, message: '请输入案由或案件名称' }]}
          >
            <Input placeholder="如：张三与李四合同纠纷案" />
          </Form.Item>

          <Space size="middle">
            <Form.Item
              name="case_number"
              label="案号"
              style={{ width: 260 }}
            >
              <Input placeholder="如：(2024)京0105民初12345号" />
            </Form.Item>

            <Form.Item
              name="case_type"
              label="案件类型"
              rules={[{ required: true, message: '请选择案件类型' }]}
              style={{ width: 180 }}
            >
              <Select
                placeholder="选择类型"
                options={CASE_TYPES.map((t) => ({ value: t, label: t }))}
              />
            </Form.Item>
          </Space>

          <Form.Item name="court" label="管辖法院">
            <Input placeholder="如：北京市朝阳区人民法院" />
          </Form.Item>

          <Form.Item name="client" label="委托人">
            <Input placeholder="委托人姓名或单位名称（可选）" />
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
        title="编辑案件"
        open={editModalOpen}
        onOk={handleUpdate}
        onCancel={() => {
          setEditModalOpen(false)
          editForm.resetFields()
          setEditingId(null)
        }}
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
            <Form.Item
              name="case_number"
              label="案号"
              style={{ width: 260 }}
            >
              <Input placeholder="如：(2024)京0105民初12345号" />
            </Form.Item>

            <Form.Item
              name="case_type"
              label="案件类型"
              rules={[{ required: true, message: '请选择案件类型' }]}
              style={{ width: 180 }}
            >
              <Select
                placeholder="选择类型"
                options={CASE_TYPES.map((t) => ({ value: t, label: t }))}
              />
            </Form.Item>
          </Space>

          <Form.Item name="court" label="管辖法院">
            <Input placeholder="如：北京市朝阳区人民法院" />
          </Form.Item>

          <Form.Item name="client" label="委托人">
            <Input placeholder="委托人姓名或单位名称（可选）" />
          </Form.Item>

          <Form.Item name="filing_date" label="立案日期">
            <DatePicker style={{ width: '100%' }} placeholder="选择日期" />
          </Form.Item>

          <Form.Item name="description" label="案情描述">
            <Input.TextArea rows={3} placeholder="简要案情描述（可选）" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
