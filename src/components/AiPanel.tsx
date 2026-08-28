import { useEffect, useRef, useState } from 'react'
import {
  Drawer, Button, Input, Switch, Tag, Space, Select, Popconfirm, Empty, Spin, Typography, message, Modal,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  LockOutlined,
  BookOutlined,
  RobotOutlined,
  CopyOutlined,
  EditOutlined,
  CheckOutlined,
  ReloadOutlined,
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
  const [privacyPromptEnabled, setPrivacyPromptEnabled] = useState(false)
  const [privacyLevel, setPrivacyLevel] = useState('standard')
  const [showPrivacyConfirm, setShowPrivacyConfirm] = useState(false)
  const [privacyPreview, setPrivacyPreview] = useState<Array<{ original: string; placeholder: string }>>([])
  const [pendingSend, setPendingSend] = useState<{ text: string; convId: string | null } | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
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
    if (open) {
      refreshConversations()
      // 读取隐私设置
      window.api.system.getConfig('ai.privacy_prompt_enabled').then((value) => {
        setPrivacyPromptEnabled(value !== 'false')
      }).catch(() => {})
      window.api.system.getConfig('ai.privacy_level').then((value) => {
        if (value) setPrivacyLevel(value)
      }).catch(() => {})
    }
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

    // 如果隐私确认启用，先预览脱敏结果
    if (privacyPromptEnabled) {
      try {
        const result = await window.api.ai.privacyPreview(text, privacyLevel)
        if (result.ok && result.preview && result.preview.length > 0) {
          setPrivacyPreview(result.preview)
          setPendingSend({ text, convId })
          setShowPrivacyConfirm(true)
          return
        }
      } catch {
        // 预览失败时继续发送
      }
    }

    // 直接发送
    executeSend(text, convId)
  }

  async function persist(convId: string, msgs: ChatMessage[], tokenDelta: number) {
    try {
      await window.api.ai.saveMessage(convId, JSON.stringify(msgs), tokenDelta)
      refreshConversations()
    } catch (err) {
      console.error('会话保存失败:', err)
    }
  }

  function handlePrivacyConfirm() {
    setShowPrivacyConfirm(false)
    if (pendingSend) {
      // 继续发送消息
      executeSend(pendingSend.text, pendingSend.convId)
      setPendingSend(null)
    }
  }

  function handlePrivacyCancel() {
    setShowPrivacyConfirm(false)
    setPendingSend(null)
    setPrivacyPreview([])
  }

  async function executeSend(text: string, convId: string | null) {
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
      // RAG 模式也要保存
      const savedMsgs = ragMode
        ? [...history, { role: 'assistant' as const, content: history[history.length - 1]?.content || '', timestamp: new Date().toISOString() }]
        : history
      await persist(activeId!, savedMsgs, estimateTokens(savedMsgs[savedMsgs.length - 1]?.content || ''))
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
      const reply = await window.api.ai.chat(convId!, history.map((m) => ({ role: m.role, content: m.content })))
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
    await persist(convId!, finalMessages, estimateTokens(finalMessages[finalMessages.length - 1]?.content || ''))
  }

  function handleSourceJump(source: { law_id: string | null; article_id: string | null }) {
    if (!source.law_id) return
    const query = source.article_id ? `?article=${source.article_id}` : ''
    navigate(`/laws/${source.law_id}${query}`)
    onClose()
  }

  async function handleCopy(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIdx(idx)
      message.success('已复制')
      setTimeout(() => setCopiedIdx(null), 2000)
    } catch {
      message.error('复制失败')
    }
  }

  function handleEditStart(idx: number, text: string) {
    setEditingIdx(idx)
    setEditText(text)
  }

  function handleEditCancel() {
    setEditingIdx(null)
    setEditText('')
  }

  async function handleEditSend(idx: number) {
    if (!editText.trim() || streaming || ragLoading) return
    // 截断到该用户消息，用修改后的内容重新发送
    const newMessages = messages.slice(0, idx)
    setMessages(newMessages)
    setEditingIdx(null)
    setEditText('')
    setInput('')

    const userMsg: ChatMessage = { role: 'user', content: editText.trim(), timestamp: new Date().toISOString() }
    const history = [...newMessages, userMsg]
    setMessages(history)

    if (ragMode) {
      setRagLoading(true)
      let finalMessages: ChatMessage[] = history
      try {
        const result = await window.api.ai.ragQuery(editText.trim())
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
      await persist(activeId!, finalMessages, estimateTokens(finalMessages[finalMessages.length - 1]?.content || ''))
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
      const reply = await window.api.ai.chat(activeId!, history.map((m) => ({ role: m.role, content: m.content })))
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
    await persist(activeId!, finalMessages, estimateTokens(finalMessages[finalMessages.length - 1]?.content || ''))
  }

  async function handleRegenerate(idx: number) {
    if (streaming || ragLoading) return
    // 找到最后一条用户消息
    const userMsgIdx = messages.slice(0, idx).reverse().findIndex(m => m.role === 'user')
    if (userMsgIdx === -1) return
    const actualUserMsgIdx = idx - 1 - userMsgIdx
    const userMsg = messages[actualUserMsgIdx]
    if (!userMsg) return

    // 截断到该用户消息，重新发送
    const newMessages = messages.slice(0, actualUserMsgIdx + 1)
    setMessages(newMessages)
    setInput('')
    setRagSources(null)

    if (ragMode) {
      setRagLoading(true)
      let finalMessages: ChatMessage[] = newMessages
      try {
        const result = await window.api.ai.ragQuery(userMsg.content)
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: result.answer,
          timestamp: new Date().toISOString(),
        }
        finalMessages = [...newMessages, assistantMsg]
        setMessages(finalMessages)
        if (result.sources && result.sources.length > 0) setRagSources(result)
      } catch (err) {
        finalMessages = [
          ...newMessages,
          { role: 'assistant', content: `[错误] ${(err as Error).message}`, timestamp: new Date().toISOString() },
        ]
        setMessages(finalMessages)
      } finally {
        setRagLoading(false)
      }
      await persist(activeId!, finalMessages, estimateTokens(finalMessages[finalMessages.length - 1]?.content || ''))
      return
    }

    // 普通聊天模式
    setStreaming(true)
    streamBufRef.current = ''
    const unsub = window.api.ai.onStreamChunk((chunk) => {
      streamBufRef.current += chunk
      const partial: ChatMessage = {
        role: 'assistant',
        content: streamBufRef.current,
        timestamp: new Date().toISOString(),
      }
      setMessages([...newMessages, partial])
    })

    let finalMessages: ChatMessage[] = newMessages
    try {
      const reply = await window.api.ai.chat(activeId!, newMessages.map((m) => ({ role: m.role, content: m.content })))
      const content = streamBufRef.current || reply
      finalMessages = [...newMessages, { role: 'assistant', content, timestamp: new Date().toISOString() }]
      setMessages(finalMessages)
    } catch (err) {
      finalMessages = [
        ...newMessages,
        { role: 'assistant', content: `[错误] ${(err as Error).message}`, timestamp: new Date().toISOString() },
      ]
      setMessages(finalMessages)
    } finally {
      unsub()
      setStreaming(false)
    }
    await persist(activeId!, finalMessages, estimateTokens(finalMessages[finalMessages.length - 1]?.content || ''))
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
                <div style={{ maxWidth: '85%' }}>
                  {editingIdx === i ? (
                    <div>
                      <Input.TextArea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        autoSize={{ minRows: 3, maxRows: 10 }}
                        style={{ marginBottom: 4 }}
                        autoFocus
                      />
                      <Space size={4}>
                        <Button size="small" type="primary" onClick={() => handleEditSend(i)}>
                          <CheckOutlined /> 发送
                        </Button>
                        <Button size="small" onClick={handleEditCancel}>取消</Button>
                      </Space>
                    </div>
                  ) : (
                    <div
                      style={{
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
                  )}
                  {m.role === 'assistant' && !streaming && m.content && editingIdx !== i && (
                    <div className="flex gap-1 mt-1" style={{ opacity: 0.6 }}>
                      <Button
                        type="text"
                        size="small"
                        icon={copiedIdx === i ? <CheckOutlined /> : <CopyOutlined />}
                        onClick={() => handleCopy(m.content, i)}
                        style={{ fontSize: 12, padding: '0 4px', height: 22 }}
                      >
                        {copiedIdx === i ? '已复制' : '复制'}
                      </Button>
                      <Button
                        type="text"
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={() => handleRegenerate(i)}
                        style={{ fontSize: 12, padding: '0 4px', height: 22 }}
                      >
                        重新生成
                      </Button>
                    </div>
                  )}
                  {m.role === 'user' && editingIdx !== i && !streaming && !ragLoading && (
                    <div className="flex gap-1 mt-1" style={{ opacity: 0.6 }}>
                      <Button
                        type="text"
                        size="small"
                        icon={copiedIdx === i ? <CheckOutlined /> : <CopyOutlined />}
                        onClick={() => handleCopy(m.content, i)}
                        style={{ fontSize: 12, padding: '0 4px', height: 22 }}
                      >
                        {copiedIdx === i ? '已复制' : '复制'}
                      </Button>
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => handleEditStart(i, m.content)}
                        style={{ fontSize: 12, padding: '0 4px', height: 22 }}
                      >
                        修改
                      </Button>
                    </div>
                  )}
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

      {/* 隐私确认弹窗 */}
      <Modal
        title="敏感信息脱敏确认"
        open={showPrivacyConfirm}
        onOk={handlePrivacyConfirm}
        onCancel={handlePrivacyCancel}
        okText="确认发送"
        cancelText="取消"
        width={480}
      >
        <div style={{ marginBottom: 12 }}>
          <Text>以下内容将被脱敏后发送给AI：</Text>
        </div>
        <div
          style={{
            background: '#f5f5f5',
            padding: '12px',
            borderRadius: 8,
            maxHeight: 200,
            overflow: 'auto',
            fontSize: 13,
          }}
        >
          {privacyPreview.map((item, index) => (
            <div key={index} style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {item.placeholder}
              </Text>
              <div style={{ color: '#ff4d4f', textDecoration: 'line-through' }}>
                {item.original}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            脱敏后的内容将发送给AI，原始信息不会被传输。
          </Text>
        </div>
      </Modal>

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
