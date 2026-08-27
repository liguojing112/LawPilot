import { useState, useEffect, useRef } from 'react'
import { Card, Button, Tag, Row, Col, Typography, Space, Divider, Statistic, Popconfirm, message, Segmented } from 'antd'
import {
  FileTextOutlined,
  FolderOpenOutlined,
  AuditOutlined,
  BulbOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  DeleteOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { SearchBar } from '../components/SearchBar'
import { formatDate } from '../utils/dateFormat'
import type { PythonStatus, DbStatus, MaterialRow, UsageStats } from '../../shared/types'

const { Title, Text, Paragraph } = Typography

export function Dashboard() {
  const navigate = useNavigate()
  const [pingResult, setPingResult] = useState<string | null>(null)
  const [pyStatus, setPyStatus] = useState<PythonStatus | null>(null)
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null)
  const [recentMaterials, setRecentMaterials] = useState<MaterialRow[]>([])
  const [loading, setLoading] = useState(false)
  const [aiPeriod, setAiPeriod] = useState<'today' | 'week' | 'month'>('today')
  const [aiUsage, setAiUsage] = useState<UsageStats | null>(null)

  const initRef = useRef(false)

  useEffect(() => {
    // 避免 React.StrictMode 双重挂载导致重复初始化
    if (initRef.current) return
    initRef.current = true

    let retries = 0

    function tryInit() {
      if (!(window as any).api) {
        if (retries < 10) {
          retries++
          setTimeout(tryInit, 200)
        }
        return
      }
      checkPythonStatus()
      checkDbStatus()
      loadRecentMaterials()
    }

    tryInit()
  }, [])

  useEffect(() => {
    loadAiUsage(aiPeriod)
  }, [aiPeriod])

  async function loadAiUsage(period: 'today' | 'week' | 'month') {
    try {
      setAiUsage(await window.api.ai.usageStats(period))
    } catch {
      setAiUsage(null)
    }
  }

  async function loadRecentMaterials() {
    try {
      const mats = await window.api.material.latest(5)
      setRecentMaterials(mats)
    } catch {
      // 数据库可能未初始化
    }
  }

  async function handleDeleteMaterial(id: string) {
    try {
      await window.api.material.delete(id)
      message.success('材料已删除')
      // 重新加载列表
      setRecentMaterials((prev) => prev.filter((m) => m.id !== id))
    } catch (err) {
      message.error(`删除失败: ${(err as Error).message}`)
    }
  }

  async function checkPythonStatus() {
    try {
      const status = await window.api.system.pythonStatus()
      setPyStatus(status)
    } catch {
      setPyStatus({ running: false, port: 18920, version: null, error: '无法检查' })
    }
  }

  async function checkDbStatus() {
    try {
      const status = await window.api.system.dbStatus()
      setDbStatus(status)
    } catch {
      // 数据库可能尚未初始化
    }
  }

  async function handleTestIpc() {
    setLoading(true)
    try {
      const result = await window.api.system.ping()
      setPingResult(result)
    } catch (err) {
      setPingResult('失败')
    } finally {
      setLoading(false)
    }
  }

  const modules = [
    {
      title: '法律法规汇编',
      desc: '全文检索，条款层级展示，新旧版本对比',
      icon: <FileTextOutlined className="text-4xl text-blue-500" />,
      path: '/laws',
    },
    {
      title: '案件管理',
      desc: '案件全生命周期管理，电子卷宗归档',
      icon: <FolderOpenOutlined className="text-4xl text-green-500" />,
      path: '/cases',
    },
    {
      title: '尽调报告',
      desc: 'RAG 增强检索，AI 辅助法律意见书',
      icon: <AuditOutlined className="text-4xl text-purple-500" />,
      path: '/due-diligence',
    },
    {
      title: '诉讼策略',
      desc: '时间线梳理，类案匹配，SWOT 分析',
      icon: <BulbOutlined className="text-4xl text-orange-500" />,
      path: '/strategy',
    },
  ]

  return (
    <div>
      <div className="mb-6">
        <Title level={2} className="!mb-2">
          LawPilot
        </Title>
        <Text type="secondary" className="text-lg">
          律师智能工作平台 —— 集成法律检索、案件管理、AI 辅助分析
        </Text>
      </div>

      {/* 全局搜索 */}
      <div className="mb-6 max-w-2xl">
        <SearchBar />
      </div>

      {/* 统计卡片 */}
      {dbStatus && (
        <Row gutter={[16, 16]} className="mb-6">
          <Col xs={12} sm={6}>
            <Card size="small" hoverable onClick={() => navigate('/laws')}>
              <Statistic
                title="法规总数"
                value={dbStatus.lawCount}
                prefix={<FileTextOutlined className="text-blue-500" />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" hoverable onClick={() => navigate('/cases')}>
              <Statistic
                title="案件总数"
                value={dbStatus.caseCount}
                prefix={<FolderOpenOutlined className="text-green-500" />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" hoverable>
              <Statistic
                title="条款总数"
                value={dbStatus.articleCount}
                prefix={<FileTextOutlined className="text-gray-400" />}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" hoverable>
              <Statistic
                title="数据库"
                value={dbStatus.path.split('\\').pop() || 'lawpilot.db'}
                prefix={<ApiOutlined className="text-gray-400" />}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* AI 使用概览 */}
      <Card size="small" className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <Space>
            <RobotOutlined className="text-purple-500" />
            <Text strong>AI 使用概览</Text>
          </Space>
          <Segmented
            size="small"
            value={aiPeriod}
            onChange={(v) => setAiPeriod(v as 'today' | 'week')}
            options={[
              { label: '今日', value: 'today' },
              { label: '本周', value: 'week' },
              { label: '本月', value: 'month' },
            ]}
          />
        </div>
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={8}>
            <Statistic title="AI 调用次数" value={aiUsage?.calls ?? 0} />
          </Col>
          <Col xs={12} sm={8}>
            <Statistic
              title="输入 Tokens"
              value={aiUsage?.total_prompt_tokens ?? 0}
              suffix={
                <Text type="secondary" className="text-xs">
                  已脱敏
                </Text>
              }
            />
          </Col>
          <Col xs={12} sm={8}>
            <Statistic title="输出 Tokens" value={aiUsage?.total_completion_tokens ?? 0} />
          </Col>
        </Row>
      </Card>

      {/* 最近上传材料 */}
      {recentMaterials.length > 0 && (
        <div className="mb-6">
          <Title level={5} className="!mb-2">最近上传材料</Title>
          <div className="flex gap-2 overflow-x-auto">
            {recentMaterials.map((m) => (
              <Card key={m.id} size="small" className="min-w-[200px] flex-shrink-0" style={{ position: 'relative' }}>
                <div className="text-sm font-medium truncate pr-4">{m.original_name}</div>
                <div className="text-xs text-gray-400">
                  <Tag className="text-xs">{m.category}</Tag>
                  {formatDate(m.created_at)}
                </div>
                <Popconfirm
                  title="确定删除此材料？"
                  description="删除后不可恢复"
                  onConfirm={() => handleDeleteMaterial(m.id)}
                  okText="删除"
                  cancelText="取消"
                  placement="bottom"
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    className="absolute top-1 right-1"
                    style={{ position: 'absolute', top: 4, right: 4 }}
                  />
                </Popconfirm>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* 功能模块卡片 */}
      <Row gutter={[16, 16]} className="mb-8">
        {modules.map((mod) => (
          <Col xs={24} sm={12} lg={6} key={mod.path}>
            <Card
              hoverable
              className="h-full transition-shadow hover:shadow-lg"
              onClick={() => navigate(mod.path)}
            >
              <div className="flex flex-col items-center text-center py-4">
                {mod.icon}
                <Title level={4} className="!mt-4 !mb-2">
                  {mod.title}
                </Title>
                <Text type="secondary" className="text-sm">
                  {mod.desc}
                </Text>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Divider />

      {/* 系统状态 */}
      <Title level={4} className="!mb-4">
        系统状态
      </Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12}>
          <Card size="small" title="IPC 通信">
            <Space direction="vertical" className="w-full">
              <div className="flex items-center justify-between">
                <Space>
                  <ApiOutlined />
                  <Text>主进程 ↔ 渲染进程</Text>
                </Space>
                <Button size="small" onClick={handleTestIpc} loading={loading}>
                  测试连接
                </Button>
              </div>
              {pingResult && (
                <div className="mt-2">
                  <Tag
                    icon={pingResult === 'pong' ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                    color={pingResult === 'pong' ? 'success' : 'error'}
                  >
                    {pingResult === 'pong' ? '通信正常' : '通信失败'}
                  </Tag>
                </div>
              )}
            </Space>
          </Card>
        </Col>

        <Col xs={24} sm={12}>
          <Card size="small" title="Python 服务">
            <Space direction="vertical" className="w-full">
              <div className="flex items-center justify-between">
                <Space>
                  {pyStatus === null ? (
                    <LoadingOutlined />
                  ) : pyStatus.running ? (
                    <CheckCircleOutlined className="text-green-500" />
                  ) : (
                    <CloseCircleOutlined className="text-red-500" />
                  )}
                  <Text>FastAPI 微服务</Text>
                </Space>
                <Button size="small" onClick={checkPythonStatus}>
                  刷新
                </Button>
              </div>
              {pyStatus && (
                <div className="mt-2">
                  <Tag color={pyStatus.running ? 'success' : 'error'}>
                    端口 {pyStatus.port}: {pyStatus.running ? '运行中' : '未连接'}
                  </Tag>
                </div>
              )}
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
