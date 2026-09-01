import { useState } from 'react'
import { Typography, Input, Button, Card, Form, Row, Col, message, Spin, Divider } from 'antd'
import { AuditOutlined, FileTextOutlined, DownloadOutlined } from '@ant-design/icons'
import { FileDropZone } from '../../components/FileDropZone'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input

export function DdWorkspace() {
  const [projectInfo, setProjectInfo] = useState({
    targetCompany: '',
    client: '',
    scope: '',
  })
  const [materialsText, setMaterialsText] = useState('')
  const [riskPoints, setRiskPoints] = useState('')
  const [report, setReport] = useState('')
  const [generating, setGenerating] = useState(false)

  async function handleGenerate() {
    if (!materialsText.trim() && !riskPoints.trim()) {
      message.warning('请先上传尽调材料或输入风险点')
      return
    }
    setGenerating(true)
    try {
      const result = await window.api.ai.generateReport('due_diligence', {
        materials_text: materialsText,
        risk_points: riskPoints,
        target_company: projectInfo.targetCompany,
        client: projectInfo.client,
        scope: projectInfo.scope,
      })
      setReport(result)
    } catch (err) {
      message.error(`生成失败: ${(err as Error).message}`)
    } finally {
      setGenerating(false)
    }
  }

  function handleMaterialProcessed(m: { raw_text?: string | null; original_name: string }) {
    if (m.raw_text) {
      setMaterialsText((prev) => prev + `\n\n【${m.original_name}】\n${m.raw_text?.slice(0, 2000) || ''}`)
      message.success(`已添加材料: ${m.original_name}`)
    } else {
      message.warning(`材料"${m.original_name}"未提取到文本（扫描件 OCR 失败或服务未启动），已跳过`)
    }
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
            <Input value={projectInfo.targetCompany} onChange={(e) => setProjectInfo({ ...projectInfo, targetCompany: e.target.value })} placeholder="如：XX科技有限公司" />
          </Col>
          <Col span={8}>
            <div className="text-sm text-gray-500 mb-1">委托方</div>
            <Input value={projectInfo.client} onChange={(e) => setProjectInfo({ ...projectInfo, client: e.target.value })} placeholder="如：XX投资有限公司" />
          </Col>
          <Col span={8}>
            <div className="text-sm text-gray-500 mb-1">尽调范围</div>
            <Input value={projectInfo.scope} onChange={(e) => setProjectInfo({ ...projectInfo, scope: e.target.value })} placeholder="如：股权投资、资产收购" />
          </Col>
        </Row>
      </Card>

      <Row gutter={16} className="mb-4">
        <Col span={12}>
          <Card title="材料上传" size="small">
            <FileDropZone storageKey="lawpilot:dd-upload" restoreProcessed onMaterialProcessed={handleMaterialProcessed} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="关键发现 / 风险点" size="small">
            <TextArea
              rows={6}
              value={riskPoints}
              onChange={(e) => setRiskPoints(e.target.value)}
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
          <Spin tip="AI 正在生成报告..." />
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
          <div className="prose max-w-none">
            {/* 简单 Markdown 渲染 */}
            {report.split('\n').map((line, i) => {
              if (line.startsWith('## '))
                return <Title key={i} level={4} className="!mt-4">{line.replace('## ', '')}</Title>
              if (line.startsWith('### '))
                return <Title key={i} level={5}>{line.replace('### ', '')}</Title>
              if (line.startsWith('- '))
                return <div key={i} className="ml-4 text-gray-700">• {line.replace('- ', '')}</div>
              if (line.startsWith('**') && line.endsWith('**'))
                return <Text key={i} strong className="block mb-2">{line.replace(/\*\*/g, '')}</Text>
              return <Paragraph key={i} className="!mb-2">{line || <br />}</Paragraph>
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
