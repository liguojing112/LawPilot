import { useState, useEffect, useCallback } from 'react'
import {
  Card, Form, Input, Button, Typography, Switch, Select, Divider, message, Tag, Space, Alert, Spin,
} from 'antd'
import {
  SettingOutlined, ApiOutlined, CheckCircleOutlined, CloseCircleOutlined, InfoCircleOutlined,
  DatabaseOutlined,
} from '@ant-design/icons'
import type { KnowledgeStatus, KnowledgeRebuildResult } from '../../../shared/types'

const { Title, Text } = Typography

const PRESET_MODELS = ['deepseek-v4-pro', 'qwen3.7-plus', 'glm-5.2', 'kimi-k2.5']

const PROVIDER_CONFIG: Record<string, { baseUrl: string; label: string; desc: string; keyHint: string }> = {
  'deepseek-v4-pro': {
    baseUrl: 'https://api.deepseek.com/v1',
    label: 'DeepSeek V4 Pro',
    desc: '国产模型，性价比极高，中文能力强',
    keyHint: '在 platform.deepseek.com/api_keys 获取',
  },
  'qwen3.7-plus': {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    label: 'Qwen 3.7 Plus',
    desc: '阿里云出品，法律领域表现优秀',
    keyHint: '在 dashscope.console.aliyun.com 获取',
  },
  'glm-5.2': {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    label: 'GLM 5.2',
    desc: '智谱AI，学术背景扎实',
    keyHint: '在 open.bigmodel.cn 获取',
  },
  'kimi-k2.5': {
    baseUrl: 'https://api.moonshot.cn/v1',
    label: 'Kimi K2.5',
    desc: '长上下文能力强，适合大量材料分析',
    keyHint: '在 platform.kimi.com 获取',
  },
}

export function SettingsPage() {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [privacyLevel, setPrivacyLevel] = useState('standard')
  const [selectedModel, setSelectedModel] = useState('deepseek-v4-pro')
  const [customModel, setCustomModel] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [kbStatus, setKbStatus] = useState<KnowledgeStatus | null>(null)
  const [kbLoading, setKbLoading] = useState(false)
  const [kbRebuilding, setKbRebuilding] = useState(false)

  const isCustom = selectedModel === '__custom__'
  const providerInfo = PROVIDER_CONFIG[selectedModel] || null

  // 保存当前的 base_url 用于判断是否被用户手动改过
  const [autoBaseUrl, setAutoBaseUrl] = useState(PROVIDER_CONFIG['deepseek-v4-pro'].baseUrl)

  useEffect(() => {
    loadConfig()
    loadKnowledgeStatus()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadKnowledgeStatus() {
    setKbLoading(true)
    try {
      setKbStatus(await window.api.knowledge.status())
    } catch {
      setKbStatus({ doc_count: 0, ok: false, error: '查询失败' })
    } finally {
      setKbLoading(false)
    }
  }

  async function handleKbRebuild() {
    setKbRebuilding(true)
    message.info('索引构建中，可能需要数分钟…')
    try {
      const res: KnowledgeRebuildResult = await window.api.knowledge.rebuild()
      if (res.ok !== false) {
        message.success(res.message || `索引重建完成（${res.doc_count} 个文档）`)
      } else {
        message.error(res.message || '索引重建失败')
      }
      loadKnowledgeStatus()
    } catch (err) {
      message.error(`索引重建失败: ${(err as Error).message}`)
    } finally {
      setKbRebuilding(false)
    }
  }

  async function handlePrivacyLevelChange(level: string) {
    setPrivacyLevel(level)
    try {
      await window.api.system.setConfig('ai.privacy_level', level)
      message.success('脱敏级别已更新')
    } catch (err) {
      message.error(`保存失败: ${(err as Error).message}`)
    }
  }

  async function loadConfig() {
    const keys = ['ai.api_key', 'ai.base_url', 'ai.model', 'ai.privacy_prompt_enabled', 'ai.privacy_level']
    const values: Record<string, string> = {}
    for (const k of keys) {
      try {
        values[k] = await window.api.system.getConfig(k)
      } catch {
        values[k] = ''
      }
    }
    const apiKey = values['ai.api_key'] || ''
    setApiKeyInput(apiKey)
    const savedModel = values['ai.model'] || 'deepseek-v4-pro'
    const privacyEnabled = values['ai.privacy_prompt_enabled'] !== 'false'
    if (values['ai.privacy_level']) {
      setPrivacyLevel(values['ai.privacy_level'])
    }

    let baseUrl = values['ai.base_url']
    if (!baseUrl) {
      baseUrl = PROVIDER_CONFIG[PRESET_MODELS.includes(savedModel) ? savedModel : 'deepseek-v4-pro']?.baseUrl || 'https://api.deepseek.com/v1'
    }

    form.setFieldsValue({ base_url: baseUrl, privacy_enabled: privacyEnabled })
    setAutoBaseUrl(baseUrl)

    if (PRESET_MODELS.includes(savedModel)) {
      setSelectedModel(savedModel)
      setCustomModel('')
    } else {
      setSelectedModel('__custom__')
      setCustomModel(savedModel)
    }
  }

  const handleModelChange = useCallback((val: string) => {
    setSelectedModel(val)
    if (val !== '__custom__') {
      setCustomModel('')
      const cfg = PROVIDER_CONFIG[val]
      if (cfg) {
        form.setFieldValue('base_url', cfg.baseUrl)
        setAutoBaseUrl(cfg.baseUrl)
      }
    }
  }, [form])

  function resolveModel(): string {
    return isCustom ? customModel.trim() : selectedModel
  }

  // 检测用户手动改了 Base URL
  function isBaseUrlCustom(): boolean {
    const current = form.getFieldValue('base_url') || ''
    return current !== autoBaseUrl
  }

  async function handleSave() {
    const modelToSave = resolveModel()
    if (!modelToSave) {
      message.error('请输入自定义模型名称')
      return
    }
    const values = form.getFieldsValue()
    console.log('[Settings] Saving:', { base_url: values.base_url, api_key: apiKeyInput ? '***' + apiKeyInput.slice(-4) : '(empty)', model: modelToSave })
    if (!apiKeyInput) {
      message.warning('未填写 API Key，保存后需补充 API Key 才能使用 AI 功能')
    }
    setSaving(true)
    try {
      await window.api.system.setConfig('ai.base_url', values.base_url)
      await window.api.system.setConfig('ai.model', modelToSave)
      await window.api.system.setConfig('ai.api_key', apiKeyInput || '')
      await window.api.system.setConfig('ai.privacy_prompt_enabled', values.privacy_enabled ? 'true' : 'false')
      setAutoBaseUrl(values.base_url)
      message.success('设置已保存')
    } catch (err) {
      message.error(`保存失败: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    const modelToTest = resolveModel()
    if (!modelToTest) {
      message.error('请输入自定义模型名称')
      return
    }
    const values = form.getFieldsValue()
    if (!apiKeyInput || !apiKeyInput.trim()) {
      message.error('请先填写 API Key 再测试连接')
      return
    }
    if (!values.base_url || !values.base_url.trim()) {
      message.error('请先填写 API Base URL 再测试连接')
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const status = await window.api.system.pythonStatus()
      if (!status.running) {
        setTestResult({ ok: false, message: 'Python 服务未启动，请先运行 npm run python:dev' })
        return
      }

      const resp = await fetch(`http://127.0.0.1:${status.port}/llm/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: values.base_url,
          api_key: apiKeyInput,
          model: modelToTest,
        }),
      })
      const data = await resp.json()
      setTestResult(data)
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  // 构建模型下拉选项（带标签区分）
  const modelOptions = [
    ...PRESET_MODELS.map((m) => {
      const cfg = PROVIDER_CONFIG[m]
      return { value: m, label: `${cfg.label} — ${cfg.desc}` }
    }),
    { value: '__custom__', label: '自定义...' },
  ]

  return (
    <div>
      <Title level={3}>
        <SettingOutlined className="mr-2" />
        设置
      </Title>

      <Card title="AI 大模型配置" className="mb-4">
        <Form form={form} layout="vertical">
          {/* 模型名称：独立于 Form，避免 value/name 冲突 */}
          <div className="mb-4">
            <div className="mb-2" style={{ color: 'rgba(0,0,0,0.88)', fontSize: 14, lineHeight: '30px' }}>
              模型名称
            </div>
            <Select
              value={selectedModel}
              onChange={handleModelChange}
              style={{ width: '100%' }}
              options={modelOptions}
            />
          </div>

          {isCustom && (
            <div className="mb-4">
              <div className="mb-2" style={{ color: 'rgba(0,0,0,0.88)', fontSize: 14, lineHeight: '30px' }}>
                自定义模型名称 <Text type="danger">*</Text>
              </div>
              <Input
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="输入模型名称，如 gpt-4o-mini"
              />
            </div>
          )}

          <Form.Item
            name="base_url"
            label="API Base URL"
            rules={[
              { required: true, message: '请填写 API Base URL' },
              { type: 'url', message: '请输入有效的 URL 地址' },
            ]}
          >
            <Input placeholder="https://api.deepseek.com/v1" />
          </Form.Item>

          {/* API Key 用独立 state，绕开 Ant Design Form 的值收集 bug */}
          <div className="mb-4">
            <div className="mb-2" style={{ color: 'rgba(0,0,0,0.88)', fontSize: 14, lineHeight: '30px' }}>
              API Key
            </div>
            <Input
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="sk-..."
            />
            {providerInfo ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                <InfoCircleOutlined style={{ marginRight: 4 }} />
                {providerInfo.keyHint}
              </Text>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                <InfoCircleOutlined style={{ marginRight: 4 }} />
                请输入对应提供商的 API Key，通常以 sk- 开头
              </Text>
            )}
          </div>

          {isCustom && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="使用自定义模型时，请手动填写正确的 API Base URL 和 API Key。Base URL 与 API Key 通常由提供商在后台提供。"
            />
          )}

          <Form.Item name="privacy_enabled" label="AI 调用前显示脱敏确认" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Space>
            <Button type="primary" onClick={handleSave} loading={saving}>
              保存设置
            </Button>
            <Button onClick={handleTest} loading={testing} icon={<ApiOutlined />} danger={false}>
              测试连接
            </Button>
            <Button
              type="link"
              onClick={() => (window as any).__showWizard?.()}
            >
              查看配置向导
            </Button>
          </Space>

          {testResult && (
            <div style={{ marginTop: 16 }}>
              <Tag
                icon={testResult.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                color={testResult.ok ? 'success' : 'error'}
              >
                {testResult.ok ? '连接成功' : '连接失败'}
              </Tag>
              {testResult.message && (
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 13 }}>
                  {testResult.message}
                </Text>
              )}
            </div>
          )}
        </Form>
      </Card>

      <Card title="隐私与脱敏" className="mb-4">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Text strong>脱敏级别</Text>
            <Select
              value={privacyLevel}
              onChange={handlePrivacyLevelChange}
              style={{ width: 200, marginLeft: 16 }}
              options={[
                { value: 'standard', label: '标准（身份证/手机号/银行账号/邮箱）' },
              ]}
            />
          </div>

          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>自动脱敏内容：</Text>
            <Space wrap>
              <Tag>身份证号</Tag>
              <Tag>手机号</Tag>
              <Tag>银行账号</Tag>
              <Tag>电子邮箱</Tag>
              <Tag>统一社会信用代码</Tag>
            </Space>
          </div>
        </div>
      </Card>

      <Card title="本地知识库" className="mb-4">
        <div className="flex items-center justify-between">
          <Space size="middle">
            {kbLoading ? (
              <Spin size="small" />
            ) : (
              <>
                <Tag icon={<DatabaseOutlined />}>{kbStatus?.ok ? '索引就绪' : '索引不可用'}</Tag>
                <Text>已索引 {kbStatus?.doc_count ?? 0} 个文档</Text>
                {kbStatus?.error && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {kbStatus.error}
                  </Text>
                )}
              </>
            )}
          </Space>
          <Space>
            <Button onClick={loadKnowledgeStatus} loading={kbLoading} disabled={kbRebuilding}>
              刷新状态
            </Button>
            <Button
              type="primary"
              onClick={handleKbRebuild}
              loading={kbRebuilding}
              disabled={kbLoading}
            >
              重建索引
            </Button>
          </Space>
        </div>
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            重建会全量重新向量化法规与案件材料，耗时较长（视数据量数分钟），期间 AI 面板的「知识库问答」会基于旧索引。
          </Text>
        </div>
      </Card>

      <Divider />

      <Card title="关于 LawPilot">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, color: '#6b7280', fontSize: 13 }}>
          <div>版本: v0.1.0</div>
          <div>技术栈: Electron + React + Ant Design + Python FastAPI</div>
          <div>数据库: SQLite (better-sqlite3)</div>
          <div>向量引擎: LanceDB + BGE-small-zh</div>
          <div>所有数据本地存储，AI 调用由用户自行配置云端 API</div>
        </div>
      </Card>
    </div>
  )
}
