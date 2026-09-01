import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Tabs, Typography, Breadcrumb, Descriptions, Tag, Spin, Card, Empty } from 'antd'
import { HomeOutlined, FileTextOutlined } from '@ant-design/icons'
import { LawTree } from '../../components/LawTree'
import { LawCompare } from './LawCompare'
import type { LawDetail, LawArticle, Revision } from '../../../shared/types'

const { Title, Text, Paragraph } = Typography

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  effective: { color: 'green', label: '现行有效' },
  amended: { color: 'orange', label: '已修订' },
  repealed: { color: 'red', label: '已失效' },
}

export function LawDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [law, setLaw] = useState<LawDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedArticle, setSelectedArticle] = useState<LawArticle | null>(null)
  const [revisions, setRevisions] = useState<Revision[]>([])

  const highlightArticleId = searchParams.get('article') || undefined

  // 从 RAG"查看条款"跳转来时，自动选中该条款（否则右侧空白，必须手动点左侧树）
  useEffect(() => {
    if (!law || !highlightArticleId) return
    const target = law.articles.find((a) => a.id === highlightArticleId)
    if (target) setSelectedArticle(target)
  }, [law, highlightArticleId])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([
      window.api.law.getById(id),
      window.api.law.getRevisions(id),
    ])
      .then(([lawData, revs]) => {
        setLaw(lawData)
        setRevisions(revs || [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  const statusTag = law ? (STATUS_MAP[law.status] || { color: 'default', label: law.status }) : null

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spin size="large" tip="加载法规详情..." />
      </div>
    )
  }

  if (!law) {
    return <Empty description="未找到该法规" />
  }

  const tabItems = [
    {
      key: 'articles',
      label: '条款浏览',
      children: (
        <div className="flex gap-4" style={{ minHeight: 500 }}>
          {/* 左侧条款树 */}
          <div className="w-80 flex-shrink-0 border-r pr-2 overflow-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
            <LawTree
              articles={law.articles}
              selectedId={selectedArticle?.id || null}
              highlightId={highlightArticleId}
              onSelect={(article) => setSelectedArticle(article)}
            />
          </div>

          {/* 右侧条款内容 */}
          <div className="flex-1 overflow-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
            {selectedArticle ? (
              <div>
                <Title level={5} className="!mb-2">
                  {selectedArticle.article_num
                    ? `${selectedArticle.article_num} ${selectedArticle.title || ''}`
                    : selectedArticle.title || '条款内容'}
                </Title>
                <Paragraph className="text-base leading-relaxed whitespace-pre-wrap">
                  {selectedArticle.content}
                </Paragraph>
                <div className="mt-4 text-gray-400 text-xs">
                  层级: {
                    ['', '编', '章', '节', '条', '款', '项', '目'][selectedArticle.level]
                  }
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                请在左侧选择条款查看内容
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'versions',
      label: `版本管理 (${revisions.length})`,
      children: (
        <LawCompare
          lawId={law.id}
          currentContent={law.full_text}
          revisions={revisions}
          onRevisionsChange={(newRevs) => setRevisions(newRevs)}
        />
      ),
    },
  ]

  return (
    <div>
      <Breadcrumb
        className="mb-4"
        items={[
          { title: <><HomeOutlined /> 首页</>, onClick: () => navigate('/') },
          { title: <><FileTextOutlined /> 法律法规</>, onClick: () => navigate('/laws') },
          { title: law.title },
        ]}
      />

      <Card className="mb-4">
        <Title level={3} className="!mb-4">{law.title}</Title>
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="效力级别">
            <Tag>{law.document_type}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="效力状态">
            {statusTag && <Tag color={statusTag.color}>{statusTag.label}</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="发文机关">{law.issuing_body || '-'}</Descriptions.Item>
          <Descriptions.Item label="发文字号">{law.document_number || '-'}</Descriptions.Item>
          <Descriptions.Item label="发布日期">{law.publish_date || '-'}</Descriptions.Item>
          <Descriptions.Item label="施行日期">{law.effective_date || '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card>
        <Tabs items={tabItems} />
      </Card>
    </div>
  )
}
