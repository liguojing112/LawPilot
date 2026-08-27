import { useState, useEffect, useCallback } from 'react'
import { Table, Button, Input, Select, Tag, Space, Typography, Progress, Alert, message } from 'antd'
import { PlusOutlined, SearchOutlined, FileTextOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { ImportResult, LawSearchResult } from '../../../shared/types'
import type { ColumnsType } from 'antd/es/table'

const { Title } = Typography

const DOC_TYPES = [
  '法律', '行政法规', '司法解释', '部门规章',
  '地方性法规', '规范性文件', '其他',
]

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  effective: { color: 'green', label: '现行有效' },
  amended: { color: 'orange', label: '已修订' },
  repealed: { color: 'red', label: '已失效' },
}

export function LawList() {
  const navigate = useNavigate()
  const [data, setData] = useState<LawSearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [docType, setDocType] = useState<string | undefined>()
  const [status, setStatus] = useState<string | undefined>()

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.law.list({
        keyword: keyword || undefined,
        document_type: docType,
        status,
        page,
        pageSize: 20,
      })
      setData(result.items)
      setTotal(result.total)
    } catch (err) {
      // 数据库未初始化时静默处理
      console.error('加载法规列表失败:', err)
    } finally {
      setLoading(false)
    }
  }, [keyword, docType, status, page])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  async function handleImport(): Promise<void> {
    const files = await window.api.file.select({
      filters: [{ name: '法规文件', extensions: ['txt', 'md'] }],
    })
    if (!files || files.length === 0) return

    const result = await window.api.law.import(files)
    if (result.imported > 0) {
      const msg = `成功导入 ${result.imported} 部${result.skipped > 0 ? `，${result.skipped} 部跳过` : ''}`
      // 静态导入 message（不要用动态 import()，会生成 import.meta.url）
      message.success(msg)
      fetchList()
    }
  }

  const columns: ColumnsType<LawSearchResult> = [
    {
      title: '法规名称',
      dataIndex: 'title',
      key: 'title',
      render: (text: string, record: LawSearchResult) => (
        <a onClick={() => navigate(`/laws/${record.id}`)}>{text}</a>
      ),
      ellipsis: true,
    },
    {
      title: '类型',
      dataIndex: 'document_type',
      key: 'document_type',
      render: (t: string) => <Tag>{t}</Tag>,
      width: 120,
    },
    {
      title: '发文机关',
      dataIndex: 'issuing_body',
      key: 'issuing_body',
      width: 160,
      ellipsis: true,
    },
    {
      title: '发布日期',
      dataIndex: 'publish_date',
      key: 'publish_date',
      width: 110,
    },
    {
      title: '效力状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => {
        const st = STATUS_MAP[s] || { color: 'default', label: s }
        return <Tag color={st.color}>{st.label}</Tag>
      },
      width: 100,
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: LawSearchResult) => (
        <Button type="link" size="small" onClick={() => navigate(`/laws/${record.id}`)}>
          查看条款
        </Button>
      ),
      width: 100,
    },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Title level={3} className="!mb-0">
          <FileTextOutlined className="mr-2" />
          法律法规汇编
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleImport}>
          导入法规
        </Button>
      </div>

      <Space className="mb-4" wrap>
        <Input
          placeholder="搜索法规名称"
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1) }}
          style={{ width: 240 }}
          allowClear
        />
        <Select
          placeholder="效力级别"
          value={docType}
          onChange={(v) => { setDocType(v); setPage(1) }}
          allowClear
          style={{ width: 140 }}
          options={DOC_TYPES.map((t) => ({ value: t, label: t }))}
        />
        <Select
          placeholder="效力状态"
          value={status}
          onChange={(v) => { setStatus(v); setPage(1) }}
          allowClear
          style={{ width: 120 }}
          options={[
            { value: 'effective', label: '现行有效' },
            { value: 'amended', label: '已修订' },
            { value: 'repealed', label: '已失效' },
          ]}
        />
      </Space>

      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: (p) => setPage(p),
          showTotal: (t) => `共 ${t} 部法规`,
          showSizeChanger: false,
        }}
      />
    </div>
  )
}
