import { useState, useEffect, useCallback } from 'react'
import { Modal, Steps, Radio, Button, Input, Form, Typography, Space, Tag, message, Result } from 'antd'
import {
  ThunderboltOutlined,
  ApiOutlined,
  SafetyOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'

const { Title, Text, Paragraph } = Typography

const PROVIDERS: Record<
  string,
  { name: string; baseUrl: string; model: string; desc: string; tag: string }
> = {
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    desc: '国产模型，性价比极高，中文能力强',
    tag: '推荐',
  },
  qwen: {
    name: '通义千问 (QWen)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.7-plus',
    desc: '阿里云出品，法律领域表现优秀',
    tag: '',
  },
  glm: {
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.2',
    desc: '清华团队研发，学术背景扎实',
    tag: '',
  },
  kimi: {
    name: 'Kimi (月之暗面)',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.5',
    desc: '长上下文能力强，适合大量材料分析',
    tag: '',
  },
  openai: {
    name: 'OpenAI 兼容',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    desc: '任何兼容 OpenAI 接口的 API 均可使用',
    tag: '通用',
  },
}

interface Props {
  onComplete?: () => void
}

export function WelcomeWizard({ onComplete }: Props) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [provider, setProvider] = useState('deepseek')
  const [baseUrl, setBaseUrl] = useState(PROVIDERS.deepseek.baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('deepseek-v4-pro')
  const [testing, setTesting] = useState(false)
  const [testOk, setTestOk] = useState<boolean | null>(null)
  const [privacyLevel, setPrivacyLevel] = useState('standard')
  const [completed, setCompleted] = useState(false)

  useEffect(() => {
    // 用微延迟确保 window.api 已经初始化
    const timer = setTimeout(() => checkFirstRun(), 500)
    return () => clearTimeout(timer)
  }, [])

  // 监听全局事件，允许其他页面主动唤起向导
  useEffect(() => {
    (window as any).__showWizard = () => {
      setStep(0)
      setProvider('deepseek')
      setBaseUrl(PROVIDERS.deepseek.baseUrl)
      setModel('deepseek-v4-pro')
      setApiKey('')
      setTestOk(null)
      setCompleted(false)
      setOpen(true)
    }
    return () => { delete (window as any).__showWizard }
  }, [])

  async function checkFirstRun() {
    try {
      // 安全检测 window.api 是否存在
      if (!(window as any).api) {
        console.log('[WelcomeWizard] window.api 不存在，跳过检查')
        return
      }
      const val = await window.api.system.getConfig('ai.wizard_completed')
      if (val !== 'true') {
        setOpen(true)
      }
    } catch {
      setOpen(true)
    }
  }

  function handleProviderChange(p: string) {
    setProvider(p)
    const cfg = PROVIDERS[p]
    setBaseUrl(cfg.baseUrl)
    setModel(cfg.model)
  }

  async function handleTestConnection() {
    setTesting(true)
    setTestOk(null)
    try {
      const status = await window.api.system.pythonStatus()
      if (!status.running) {
        message.error('本地服务尚未就绪，请稍候几秒后重试（启动过程中属正常现象）')
        setTestOk(false)
        return
      }
      const resp = await fetch(`http://127.0.0.1:${status.port}/llm/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_url: baseUrl, api_key: apiKey, model }),
      })
      const data = await resp.json()
      setTestOk(data.ok)
      if (data.ok) {
        message.success('连接成功！')
      } else {
        message.error(`连接失败: ${data.message}`)
      }
    } catch (err) {
      setTestOk(false)
      message.error(`测试失败: ${(err as Error).message}`)
    } finally {
      setTesting(false)
    }
  }

  async function handleFinish() {
    await window.api.system.setConfig('ai.base_url', baseUrl)
    await window.api.system.setConfig('ai.model', model)
    if (apiKey) {
      await window.api.system.setConfig('ai.api_key', apiKey)
    }
    await window.api.system.setConfig('ai.privacy_level', privacyLevel)
    await window.api.system.setConfig('ai.wizard_completed', 'true')
    setCompleted(true)
    setTimeout(() => {
      setOpen(false)
      onComplete?.()
    }, 1500)
  }

  function handleSkip() {
    setOpen(false)
    onComplete?.()
  }

  if (!open) return null

  return (
    <Modal
      open={open}
      closable={false}
      footer={null}
      width={620}
      centered
    >
      {completed ? (
        <Result
          status="success"
          title="配置完成！"
          subTitle="LawPilot 已就绪，开始您的智能法律服务之旅。"
        />
      ) : (
        <div className="py-4">
          <div className="text-center mb-6">
            <ThunderboltOutlined className="text-4xl text-blue-500 mb-2" />
            <Title level={3} className="!mb-1">⚖️ 欢迎使用 LawPilot</Title>
            <Text type="secondary">律师智能工作平台 — 只需几步即可开始</Text>
          </div>

          <Steps
            current={step}
            className="mb-6"
            size="small"
            items={[
              { title: '选择模型提供商' },
              { title: '输入 API 凭据' },
              { title: '个性化设置' },
            ]}
          />

          {/* 步骤 1 */}
          {step === 0 && (
            <div>
              <Text strong className="block mb-3">选择大模型提供商</Text>
              {Object.entries(PROVIDERS).map(([key, cfg]) => (
                <div
                  key={key}
                  className={`border rounded-lg p-3 mb-2 cursor-pointer transition-colors ${
                    provider === key ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => handleProviderChange(key)}
                >
                  <div className="flex items-center justify-between">
                    <Space>
                      <Radio checked={provider === key} />
                      <Text strong>{cfg.name}</Text>
                      {cfg.tag && <Tag color="blue">{cfg.tag}</Tag>}
                    </Space>
                  </div>
                  <Text type="secondary" className="text-sm ml-8">{cfg.desc}</Text>
                </div>
              ))}

              <div
                className={`border rounded-lg p-3 mb-2 cursor-pointer transition-colors ${
                  provider === 'skip' ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => setProvider('skip')}
              >
                <Space>
                  <Radio checked={provider === 'skip'} />
                  <Text>稍后配置</Text>
                </Space>
              </div>
            </div>
          )}

          {/* 步骤 2 */}
          {step === 1 && (
            <div>
              <Form layout="vertical">
                <Form.Item label="Base URL">
                  <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                </Form.Item>
                <Form.Item label="API Key">
                  <Input.Password
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    addonAfter={
                      <Button size="small" type="link" onClick={handleTestConnection} loading={testing}>
                        测试连接
                      </Button>
                    }
                  />
                </Form.Item>
                {testOk !== null && (
                  <Tag color={testOk ? 'success' : 'error'} className="mb-3">
                    {testOk ? '连接成功' : '连接失败'}
                  </Tag>
                )}
                <Form.Item label="模型名称">
                  <Input value={model} onChange={(e) => setModel(e.target.value)} />
                </Form.Item>
                <div className="text-gray-400 text-sm">
                  <SafetyOutlined className="mr-1" />
                  🔒 您的 API Key 将加密存储在本机，不会上传至任何第三方
                </div>
              </Form>
            </div>
          )}

          {/* 步骤 3 */}
          {step === 2 && (
            <div>
              <div className="mb-4">
                <Text strong className="block mb-2">脱敏级别</Text>
                <Space>
                  <div
                    className="border rounded-lg p-3 cursor-pointer border-blue-400 bg-blue-50"
                  >
                    <Radio checked className="mr-2" />
                    <span>标准 — 身份证、手机号、银行账号、邮箱</span>
                  </div>
                </Space>
              </div>
              <Text type="secondary" className="text-sm">
                AI 调用前会自动对敏感信息脱敏处理，替换为占位符后发送至云端。
              </Text>
            </div>
          )}

          {/* 底部按钮 */}
          <div className="flex justify-between mt-8 pt-4 border-t">
            <div>
              {step > 0 && (
                <Button onClick={() => setStep(step - 1)}>上一步</Button>
              )}
            </div>
            <Space>
              <Button type="link" onClick={handleSkip}>跳过</Button>
              {step < 2 ? (
                <Button type="primary" onClick={() => setStep(step + 1)}>下一步</Button>
              ) : (
                <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleFinish}>
                  开始使用 LawPilot
                </Button>
              )}
            </Space>
          </div>
        </div>
      )}
    </Modal>
  )
}
