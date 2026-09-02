import { useState, useEffect } from 'react'
import { Typography, Input, Button, Card, Form, Row, Col, message, Spin, Divider } from 'antd'
import { AuditOutlined, FileTextOutlined, DownloadOutlined } from '@ant-design/icons'
import { FileDropZone } from '../../components/FileDropZone'
import { Markdown } from '../../components/Markdown'

const { Title, Text } = Typography
const { TextArea } = Input

const PROJECT_KEY = 'lawpilot:dd-project'

// 模块级状态：切换页面（组件卸载/重挂）、StrictMode 双挂载间存活，
// 进行中的报告生成不丢；项目信息/风险点额外持久化到 localStorage
const ddStore: {
  materialsText: string
  projectInfo: { targetCompany: string; client: string; scope: string }
  riskPoints: string
  report: string
  generating: boolean
  pending: Promise<string> | null
} = {
  materialsText: '',
  projectInfo: { targetCompany: '', client: '', scope: '' },
  riskPoints: '',
  report: '',
  generating: false,
  pending: null,
}

export function DdWorkspace() {
  const [projectInfo, setProjectInfo] = useState(ddStore.projectInfo)
  const [materialsText, setMaterialsText] = useState(ddStore.materialsText)
  const [riskPoints, setRiskPoints] = useState(ddStore.riskPoints)
  const [report, setReport] = useState(ddStore.report)
  const [generating, setGenerating] = useState(ddStore.generating)

  // 应用重启后恢复项目信息/风险点（本会话内已有则不覆盖）
  useEffect(() => {
    if (ddStore.projectInfo.targetCompany || ddStore.projectInfo.client
      || ddStore.projectInfo.scope || ddStore.riskPoints) return
    try {
      const saved = localStorage.getItem(PROJECT_KEY)
      if (saved) {
        const p = JSON.parse(saved)
        if (p.projectInfo) ddStore.projectInfo = { ...ddStore.projectInfo, ...p.projectInfo }
        if (typeof p.riskPoints === 'string') ddStore.riskPoints = p.riskPoints
        setProjectInfo(ddStore.projectInfo)
        setRiskPoints(ddStore.riskPoints)
      }
    } catch { /* 忽略存储异常 */ }
  }, [])

  // 切页时报告还在生成中：重挂后订阅进行中的请求，完成后回填
  useEffect(() => {
    if (!ddStore.pending) return
    ddStore.pending
      .then((r) => {
        setReport(r)
        setGenerating(false)
      })
      .catch(() => setGenerating(false))
  }, [])

  function saveProject() {
    try {
      localStorage.setItem(PROJECT_KEY, JSON.stringify({
        projectInfo: ddStore.projectInfo,
        riskPoints: ddStore.riskPoints,
      }))
    } catch { /* 忽略存储异常 */ }
  }

  function updateProjectInfo(v: { targetCompany: string; client: string; scope: string }) {
    ddStore.projectInfo = v
    setProjectInfo(v)
    saveProject()
  }

  function updateRiskPoints(v: string) {
    ddStore.riskPoints = v
    setRiskPoints(v)
    saveProject()
  }

  async function handleGenerate() {
    if (!materialsText.trim() && !riskPoints.trim()) {
      message.warning('请先上传尽调材料或输入风险点')
      return
    }
    ddStore.generating = true
    ddStore.report = ''
    setGenerating(true)
    setReport('')
    const pending = window.api.ai.generateReport('due_diligence', {
      materials_text: materialsText,
      risk_points: riskPoints,
      target_company: ddStore.projectInfo.targetCompany,
      client: ddStore.projectInfo.client,
      scope: ddStore.projectInfo.scope,
    })
      .then((r) => {
        ddStore.report = r
        ddStore.pending = null
        return r
      })
      .catch((err) => {
        ddStore.generating = false
        ddStore.pending = null
        throw err
      })
    ddStore.pending = pending
    try {
      const r = await pending
      setReport(r)
    } catch (err) {
      message.error(`生成失败: ${(err as Error).message}`)
    } finally {
      ddStore.generating = false
      setGenerating(false)
    }
  }

  // 幂等追加：文本池已含该材料（按文件名标记）则跳过，
  // 防止 StrictMode 双挂载 / 切页恢复时重复入池
  function appendMaterialText(m: { raw_text?: string | null; original_name: string }) {
    if (!m.raw_text) return
    const marker = `【${m.original_name}】`
    if (ddStore.materialsText.includes(marker)) return
    const block = `${marker}\n${m.raw_text.slice(0, 2000)}`
    ddStore.materialsText = ddStore.materialsText
      ? `${ddStore.materialsText}\n\n${block}`
      : block
    setMaterialsText(ddStore.materialsText)
  }

  function handleMaterialProcessed(m: { raw_text?: string | null; original_name: string }) {
    appendMaterialText(m)
    if (m.raw_text) {
      message.success(`已添加材料: ${m.original_name}`)
    } else {
      message.warning(`材料"${m.original_name}"未提取到文本（扫描件 OCR 失败或服务未启动），已跳过`)
    }
  }

  // 切页/重启后静默恢复文本池：不弹任何提示
  function handleMaterialRestored(m: { raw_text?: string | null; original_name: string }) {
    appendMaterialText(m)
  }

  return (
    <div>
      <Title level={3}>
        <AuditOutlined className="mr-2" />
        非诉法律尽职调查
      </Title>

      <Card title="项目信息" className="mb-4" size="small">
        <Row gutter={16}>
          <Col span={8}>
            <div className="text-sm text-gray-500 mb-1">目标公司</div>
            <Input value={projectInfo.targetCompany} onChange={(e) => updateProjectInfo({ ...projectInfo, targetCompany: e.target.value })} placeholder="如：XX科技有限公司" />
          </Col>
          <Col span={8}>
            <div className="text-sm text-gray-500 mb-1">委托方</div>
            <Input value={projectInfo.client} onChange={(e) => updateProjectInfo({ ...projectInfo, client: e.target.value })} placeholder="如：XX投资有限公司" />
          </Col>
          <Col span={8}>
            <div className="text-sm text-gray-500 mb-1">尽调范围</div>
            <Input value={projectInfo.scope} onChange={(e) => updateProjectInfo({ ...projectInfo, scope: e.target.value })} placeholder="如：股权投资、资产收购" />
          </Col>
        </Row>
      </Card>

      <Row gutter={16} className="mb-4">
        <Col span={12}>
          <Card title="材料上传" size="small">
            <FileDropZone storageKey="lawpilot:dd-upload" restoreProcessed onMaterialProcessed={handleMaterialProcessed} onMaterialRestored={handleMaterialRestored} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="关键发现 / 风险点" size="small">
            <TextArea
              rows={6}
              value={riskPoints}
              onChange={(e) => updateRiskPoints(e.target.value)}
              placeholder="输入人工发现的风险点（每行一条），将纳入报告生成..."
            />
          </Card>
        </Col>
      </Row>

      {materialsText && (
        <Card title={`已收集材料文本 (${materialsText.length} 字)`} size="small" className="mb-4">
          <div className="max-h-32 overflow-auto text-gray-500 text-xs whitespace-pre-wrap">
            {materialsText.slice(0, 1000)}
            {materialsText.length > 1000 && '...'}
          </div>
        </Card>
      )}

      <div className="mb-4">
        <Button type="primary" size="large" onClick={handleGenerate} loading={generating}>
          开始生成报告
        </Button>
      </div>

      {generating && (
        <div className="flex justify-center py-8">
          <Spin size="large" />
          <div className="mt-4 text-center">
            <Text>AI 正在生成尽调报告…</Text>
            <br />
            <Text type="secondary" className="text-sm">
              通常需要 1~3 分钟，可切换到其他页面，完成后回来查看
            </Text>
          </div>
        </div>
      )}

      {report && (
        <Card
          title="法律尽职调查报告"
          extra={
            <Button icon={<DownloadOutlined />} onClick={() => {
              const blob = new Blob([report], { type: 'text/markdown' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url; a.download = '尽职调查报告.md'; a.click()
              URL.revokeObjectURL(url)
            }}>
              导出 Markdown
            </Button>
          }
        >
        <div className="max-w-none overflow-x-auto">
          <Markdown>{report}</Markdown>
        </div>
        </Card>
      )}
    </div>
  )
}
