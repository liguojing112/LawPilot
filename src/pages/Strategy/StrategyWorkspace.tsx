import { useState, useEffect } from 'react'
import {
  Typography, Input, Button, Card, Row, Col, Tag, Timeline, List, Collapse, message, Spin, Empty,
} from 'antd'
import {
  BulbOutlined, ClockCircleOutlined, FileTextOutlined,
  CheckCircleOutlined, CloseCircleOutlined, WarningOutlined, RiseOutlined,
} from '@ant-design/icons'
import { Markdown } from '../../components/Markdown'

const { Title, Text } = Typography
const { TextArea } = Input
const { Panel } = Collapse

interface StrategyResult {
  timelines?: Array<{ date: string; event: string; importance: string }>
  parties?: Array<{ name: string; role: string }>
  dispute_focus?: string[]
  matched_laws?: Array<{ title: string; article: string; relevance: string }>
  strengths?: string[]
  weaknesses?: string[]
  opportunities?: string[]
  threats?: string[]
  analysis?: string
  suggestions?: string[]
  _related_laws?: Array<{ id: string; source_type: string; title: string; text: string; law_id?: string; article_id?: string }>
}

const IMPORTANCE_COLOR: Record<string, string> = {
  'high': 'red',
  'medium': 'orange',
  'low': 'gray',
}

const FACTS_KEY = 'lawpilot:strategy:facts'

// 模块级状态：切换页面（组件卸载/重挂）后存活，
// 避免案情被清空、进行中的推演结果丢失
const strategyStore: {
  facts: string
  analyzing: boolean
  result: StrategyResult | null
  pending: Promise<StrategyResult> | null
} = {
  facts: '',
  analyzing: false,
  result: null,
  pending: null,
}

export function StrategyWorkspace() {
  const [facts, setFacts] = useState(strategyStore.facts)
  const [analyzing, setAnalyzing] = useState(strategyStore.analyzing)
  const [result, setResult] = useState<StrategyResult | null>(strategyStore.result)

  // 应用重启后从 localStorage 恢复案情描述
  useEffect(() => {
    if (strategyStore.facts) return
    try {
      const saved = localStorage.getItem(FACTS_KEY)
      if (saved) {
        strategyStore.facts = saved
        setFacts(saved)
      }
    } catch { /* 忽略存储异常 */ }
  }, [])

  // 切页时推演仍在进行：重挂后订阅进行中的请求，完成后回填结果
  useEffect(() => {
    if (!strategyStore.pending) return
    strategyStore.pending
      .then((res) => {
        setResult(res)
        setAnalyzing(false)
      })
      .catch(() => setAnalyzing(false))
  }, [])

  function updateFacts(v: string) {
    strategyStore.facts = v
    setFacts(v)
    try {
      localStorage.setItem(FACTS_KEY, v)
    } catch { /* 忽略存储异常 */ }
  }

  async function handleAnalyze() {
    if (!facts.trim() || facts.trim().length < 20) {
      message.warning('请输入至少 20 字的案情描述')
      return
    }
    strategyStore.analyzing = true
    strategyStore.result = null
    setAnalyzing(true)
    setResult(null)
    const pending = window.api.ai.swotAnalysis(facts.trim())
      .then((res) => {
        const r = res as StrategyResult
        strategyStore.result = r
        strategyStore.pending = null
        return r
      })
      .catch((err) => {
        strategyStore.analyzing = false
        strategyStore.pending = null
        throw err
      })
    strategyStore.pending = pending
    try {
      const res = await pending
      setResult(res)
    } catch (err) {
      message.error(`分析失败: ${(err as Error).message}`)
    } finally {
      strategyStore.analyzing = false
      setAnalyzing(false)
    }
  }

  return (
    <div>
      <Title level={3}>
        <BulbOutlined className="mr-2" />
        诉讼策略推演
      </Title>

      <Card title="案情描述" className="mb-4">
        <TextArea
          rows={8}
          value={facts}
          onChange={(e) => updateFacts(e.target.value)}
          placeholder={'请详细描述案件事实，包括:\n- 当事人信息\n- 事件经过（含日期）\n- 争议焦点\n- 已有证据\n- 对方主张\n\n示例: 甲于2024年3月1日借给乙10万元，约定月利率1%，还款期2024年9月1日。乙逾期未还，甲持银行转账记录和书面借条起诉...'}
        />
        <div className="mt-4 flex items-center justify-between">
          <Text type="secondary" className="text-sm">
            🔒 发送内容将自动脱敏处理
          </Text>
          <Button type="primary" size="large" onClick={handleAnalyze} loading={analyzing}>
            开始推演
          </Button>
        </div>
      </Card>

      {analyzing && (
        <div className="flex justify-center py-8">
          <Spin size="large" />
          <div className="mt-4 text-center">
            <Text>AI 正在推演分析，正在检索法条并生成 SWOT 矩阵…</Text>
            <br />
            <Text type="secondary" className="text-sm">
              通常需要 1~2 分钟，请勿关闭页面
            </Text>
          </div>
        </div>
      )}

      {result && !result.analysis && (result as any).error && (
        <Card><Text type="danger">{(result as any).error}</Text></Card>
      )}

      {result && result.analysis && (
        <div>
          {/* 时间线与当事人 */}
          {(result.timelines?.length || result.parties?.length) && (
            <Row gutter={16} className="mb-4">
              {result.timelines && result.timelines.length > 0 && (
                <Col span={12}>
                  <Card title={<><ClockCircleOutlined className="mr-1" />案情时间线</>} size="small">
                    <Timeline
                      items={result.timelines.map((t) => ({
                        color: IMPORTANCE_COLOR[t.importance] || 'gray',
                        children: (
                          <div>
                            <Text strong className="text-sm">{t.date}</Text>
                            <br />
                            <Text className="text-sm">{t.event}</Text>
                          </div>
                        ),
                      }))}
                    />
                  </Card>
                </Col>
              )}
              {result.parties && result.parties.length > 0 && (
                <Col span={12}>
                  <Card title="当事人" size="small">
                    {result.parties.map((p, i) => (
                      <Tag key={i} className="mb-1">{p.role}: {p.name}</Tag>
                    ))}
                  </Card>
                  {result.dispute_focus && result.dispute_focus.length > 0 && (
                    <Card title="争议焦点" size="small" className="mt-3">
                      {result.dispute_focus.map((d, i) => (
                        <Tag key={i} color="orange">{d}</Tag>
                      ))}
                    </Card>
                  )}
                </Col>
              )}
            </Row>
          )}

          {/* 法条匹配 */}
          <Collapse className="mb-4" items={[{
            key: 'laws',
            label: <><FileTextOutlined className="mr-1" />匹配法条 ({result.matched_laws?.length || 0})</>,
            children: (
              <List
                size="small"
                dataSource={result.matched_laws || result._related_laws?.map(l => ({ title: l.title, article: l.text.slice(0, 50), relevance: l.text.slice(0, 200) })) || []}
                renderItem={(item: any, i: number) => (
                  <List.Item>
                    <div>
                      <Text strong>{item.title}</Text>
                      {item.article && <Tag className="ml-2">{item.article}</Tag>}
                      <br />
                      <Text type="secondary" className="text-sm">{item.relevance}</Text>
                    </div>
                  </List.Item>
                )}
              />
            ),
          }]} />

          {/* SWOT 矩阵 2x2 */}
          <Row gutter={16} className="mb-4">
            <Col span={12}>
              <Card
                title={<><CheckCircleOutlined className="text-green-500 mr-1" />有利点 (Strengths)</>}
                size="small"
                className="border-green-200"
              >
                {result.strengths?.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 mb-1">
                    <CheckCircleOutlined className="text-green-500 mt-1" />
                    <Text className="text-sm">{s}</Text>
                  </div>
                ))}
                {(!result.strengths || result.strengths.length === 0) && <Empty description="未分析到" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              </Card>
            </Col>
            <Col span={12}>
              <Card
                title={<><CloseCircleOutlined className="text-red-500 mr-1" />不利点 (Weaknesses)</>}
                size="small"
                className="border-red-200"
              >
                {result.weaknesses?.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 mb-1">
                    <CloseCircleOutlined className="text-red-500 mt-1" />
                    <Text className="text-sm">{w}</Text>
                  </div>
                ))}
                {(!result.weaknesses || result.weaknesses.length === 0) && <Empty description="未分析到" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              </Card>
            </Col>
            <Col span={12}>
              <Card
                title={<><RiseOutlined className="text-blue-500 mr-1" />机会 (Opportunities)</>}
                size="small"
                className="border-blue-200 mt-3"
              >
                {result.opportunities?.map((o, i) => (
                  <div key={i} className="flex items-start gap-2 mb-1">
                    <RiseOutlined className="text-blue-500 mt-1" />
                    <Text className="text-sm">{o}</Text>
                  </div>
                ))}
                {(!result.opportunities || result.opportunities.length === 0) && <Empty description="未分析到" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              </Card>
            </Col>
            <Col span={12}>
              <Card
                title={<><WarningOutlined className="text-orange-500 mr-1" />威胁 (Threats)</>}
                size="small"
                className="border-orange-200 mt-3"
              >
                {result.threats?.map((t, i) => (
                  <div key={i} className="flex items-start gap-2 mb-1">
                    <WarningOutlined className="text-orange-500 mt-1" />
                    <Text className="text-sm">{t}</Text>
                  </div>
                ))}
                {(!result.threats || result.threats.length === 0) && <Empty description="未分析到" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              </Card>
            </Col>
          </Row>

           {/* 综合分析 */}
           {result.analysis && (
             <Card title="综合分析" className="mb-4">
               <Markdown>{result.analysis}</Markdown>
             </Card>
           )}

          {/* 应对建议 */}
          {result.suggestions && result.suggestions.length > 0 && (
            <Card title="应对策略建议">
              <List
                size="small"
                dataSource={result.suggestions}
                renderItem={(s: string, i: number) => (
                  <List.Item>
                    <Text strong className="mr-2">{(i + 1)}.</Text>
                    <Text>{s}</Text>
                  </List.Item>
                )}
              />
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
