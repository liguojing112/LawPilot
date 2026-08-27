import { useEffect, useRef, useState } from 'react'
import {
  Drawer, Button, Input, Switch, Tag, Space, Select, Popconfirm, Empty, Spin, Typography, message,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  LockOutlined,
  BookOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { ChatMessage, ConversationRow, RagResult } from '../../shared/types'

const { Text } = Typography

interface AiPanelProps {
  open: boolean
  onClose: () => void
}

function safeParseMessages(json: string): ChatMessage[] {
  try {
    const parsed = JSON.parse(json || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 粗估 token 数（中文约 1.5 字符/token，英文约 4 字符/token），用于会话累计展示 */
function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (ch.codePointAt(0)! > 0x2e7f) cjk++
    else other++
  }
  return Math.ceil(cjk / 1.5 + other / 4)
}

export function AiPanel({ open, onClose }: AiPanelProps) {
  const navigate = useNavigate()
  const [conversations, setConversations] = useState<ConversationRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [ragMode, setRagMode] = useState(false)
  const [ragSources, setRagSources] = useState<RagResult | null>(null)
  const [ragLoading, setRagLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const listEndRef = useRef<HTMLDivElement>(null)
  const streamBufRef = useRef('')

  async function refreshConversations() {
    try {
      setConversations(await window.api.ai.listConversations())
    } catch {
      /* 数据库异常时保持原列表 */
    }
  }

  useEffect(() => {
    if (open) refreshConversations()
  }, [open])

  // 切换会话时加载历史消息
  useEffect(() => {
    if (!open) return
    if (!activeId) {
      setMessages([])
      setRagSources(null)
      return
    }
    window.api.ai
      .listConversations()
      .then((list) => {
        const conv = list.find((c) => c.id === activeId)
        setMessages(conv ? safeParseMessages(conv.messages) : [])
        setRagSources(null)
      })
      .catch(() => setMessages([]))
  }, [activeId, open])

  // 清理流式监听
  useEffect(() => {
    return () => {
      window.api.ai.offStreamChunk()
    }
  }, [])

  // 自动滚动到底部
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleNewConversation() {
    if (streaming || ragLoading) return
    setActiveId(null)
    setMessages([])
    setRagSources(null)
  }

  async function handleDeleteConversation(id: string) {
    try {
      await window.api.ai.deleteConversation(id)
      if (id === activeId) {
        const rest = conversations.filter((c) => c.id !== id)
        setActiveId(rest[0]?.id ?? null)
      }
      refreshConversations()
    } catch (err) {
      message.error(`删除失败: ${(err as Error).message}`)
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || streaming || ragLoading) return

    let convId = activeId
    if (!convId) {
      try {
        const conv = await window.api.ai.createConversation(text.slice(0, 20), ragMode ? 'rag' : 'chat')
        convId = conv.id
        setActiveId(convId)
        refreshConversations()
      } catch (err) {
        message.error(`创建会话失败: ${(err as Error).message}`)
        return
      }
    }

    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: new Date().toISOString() }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput('')
    setRagSources(null)

    if (ragMode) {
      setRagLoading(true)
      let finalMessages: ChatMessage[] = history
      try {
        const result = await window.api.ai.ragQuery(text)
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: result.answer,
          timestamp: new Date().toISOString(),
        }
        finalMessages = [...history, assistantMsg]
        setMessages(finalMessages)
        if (result.sources && result.sources.length > 0) setRagSources(result)
      } catch (err) {
        finalMessages = [
          ...history,
          { role: 'assistant', content: `[错误] ${(err as Error).message}`, timestamp: new Date().toISOString() },
        ]
        setMessages(finalMessages)
      } finally {
        setRagLoading(false)
      }
      await persist(convId, finalMessages, estimateTokens(finalMessages[finalMessages.length - 1]?.content || ''))
      return
    }

    setStreaming(true)
    streamBufRef.current = ''
    const unsub = window.api.ai.onStreamChunk((chunk) => {
      streamBufRef.current += chunk
      const partial: ChatMessage = {
        role: 'assistant',
        content: streamBufRef.current,
        timestamp: new Date().toISOString(),
      }
      setMessages([...history, partial])
    })

    let finalMessages: ChatMessage[] = history
    try {
      const reply = await window.api.ai.chat(convId, history.map((m) => ({ role: m.role, content: m.content })))
      // 流式未产生内容（如后端错误）时用返回值兜底
      const content = streamBufRef.current || reply
      finalMessages = [...history, { role: 'assistant', content, timestamp: new Date().toISOString() }]
      setMessages(finalMessages)
    } catch (err) {
      finalMessages = [
        ...history,
        { role: 'assistant', content: `[错误] ${(err as Error).message}`, timestamp: new Date().toISOString() },
      ]
      setMessages(finalMessages)
    } finally {
      unsub()
      setStreaming(false)
    }
    await persist(convId, finalMessages, estimateTokens(finalMessages[finalMessages.length - 1]?.content || ''))
  }

  async function persist(convId: string, msgs: ChatMessage[], tokenDelta: number) {
    try {
      await window.api.ai.saveMessage(convId, JSON.stringify(msgs), tokenDelta)
      refreshConversations()
    } catch (err) {
      console.error('会话保存失败:', err)
    }
  }

  function handleSourceJump(source: { law_id: string | null; article_id: string | null }) {
    if (!source.law_id) return
    const query = source.article_id ? `?article=${source.article_id}` : ''
    navigate(`/laws/${source.law_id}${query}`)
    onClose()
  }

  const convOptions = conversations.map((c) => ({
    value: c.id,
    label: c.title || '未命名会话',
  }))

  return (
    <Drawer
      title={
        <Space>
          <RobotOutlined />
          AI 对话
          <Tag icon={<LockOutlined />} color="green">
            敏感信息已自动脱敏
          </Tag>
        </Space>
      }
      open={open}
      onClose={onClose}
      width={520}
      extra={
        <Space>
          <Switch
            size="small"
            checked={ragMode}
            onChange={setRagMode}
            disabled={streaming || ragLoading}
          />
          <Text type="secondary" className="text-xs">
            知识库问答
          </Text>
        </Space>
      }
    >
      {/* 会话管理 */}
      <div className="flex items-center gap-2 mb-3">
        <Select
          className="flex-1"
          size="small"
          placeholder="选择历史会话"
          allowClear
          value={activeId}
          onChange={(v) => setActiveId(v ?? null)}
          options={convOptions}
          disabled={streaming || ragLoading}
          status={conversations.length === 0 ? undefined : 'success'}
        />
        <Button size="small" icon={<PlusOutlined />} onClick={handleNewConversation} disabled={streaming || ragLoading}>
          新建
        </Button>
        {activeId && (
          <Popconfirm title="删除该会话？" onConfirm={() => handleDeleteConversation(activeId)}>
            <Button size="small" danger icon={<DeleteOutlined />} disabled={streaming || ragLoading} />
          </Popconfirm>
        )}
      </div>

      {/* 消息流 */}
      <div className="flex-1 overflow-auto" style={{ minHeight: 240 }}>
        {messages.length === 0 && !ragLoading ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="输入法律问题开始对话，开启「知识库问答」可检索本地法规库"
          />
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  style={{
                    maxWidth: '85%',
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: m.role === 'user' ? '#1677ff' : '#f5f5f5',
                    color: m.role === 'user' ? '#fff' : 'inherit',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: 13,
                    lineHeight: 1.7,
                  }}
                >
                  {m.content || (m.role === 'assistant' && streaming ? '' : '（空）')}
                </div>
              </div>
            ))}
            {ragLoading && (
              <Space>
                <Spin size="small" />
                <Text type="secondary" className="text-xs">
                  正在检索本地知识库并生成回答…
                </Text>
              </Space>
            )}

            {/* RAG 引用来源 */}
            {ragSources && ragSources.sources.length > 0 && (
              <div
                style={{
                  border: '1px solid #d9e8ff',
                  background: '#f0f7ff',
                  borderRadius: 8,
                  padding: '8px 12px',
                }}
              >
                <Text strong className="text-xs">
                  <BookOutlined className="mr-1" />
                  参考来源
                </Text>
                <div className="mt-1 flex flex-col gap-2">
                  {ragSources.sources.map((s, i) => (
                    <div key={s.id || i} className="text-xs">
                      <div className="flex items-center gap-2">
                        <Tag style={{ marginInlineEnd: 0 }}>{s.source_type || '资料'}</Tag>
                        <Text>{s.title || '未命名'}</Text>
                        {s.law_id && (
                          <Button type="link" size="small" style={{ padding: 0, fontSize: 12 }} onClick={() => handleSourceJump(s)}>
                            查看条款
                          </Button>
                        )}
                      </div>
                      {s.snippet && (
                        <Text type="secondary" className="block" style={{ fontSize: 12 }}>
                          {s.snippet}
                        </Text>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div ref={listEndRef} />
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="mt-3 flex items-end gap-2">
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={ragMode ? '基于本地知识库提问，如：合同解除后违约金如何计算？' : '输入你的法律问题…'}
          autoSize={{ minRows: 1, maxRows: 5 }}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          disabled={streaming || ragLoading}
        />
        <Button
          type="primary"
          onClick={handleSend}
          loading={streaming || ragLoading}
          disabled={!input.trim()}
        >
          发送
        </Button>
      </div>
    </Drawer>
  )
}
