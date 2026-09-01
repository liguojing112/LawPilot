import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS, type LlmMessage } from '../../../shared/types'
import { pythonBridge } from '../services/python-bridge'
import {
  createConversation,
  updateConversationMessages,
  deleteConversation,
  listConversations,
  createUsageLog,
  getUsageStats,
} from '../services/database'

/** Electron 主进程侧简易脱敏（避免每次调用 Python） */
function quickMask(text: string): string {
  return text
    .replace(/\b\d{17}[\dXx]\b|\b\d{15}\b/g, '[身份证号]')
    .replace(/\b1[3-9]\d{9}\b/g, '[手机号]')
    .replace(/\b\d{16,19}\b/g, '[银行账号]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[邮箱]')
}

export function registerAiIpc(): void {
  // ---- 流式聊天 ----
  ipcMain.handle(IPC_CHANNELS.AI_CHAT, async (event, convId: string, messages: LlmMessage[]) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    try {
      // 脱敏（仅最近一轮用户输入需要主进程快速脱敏，Python 端还会按脱敏级别处理）
      const masked = messages.map((m) => ({ ...m, content: quickMask(m.content) }))

      const status = await pythonBridge.getStatus()
      if (!status.running) {
        return 'Python 服务未启动，请先启动 Python 服务'
      }

      // 流式调用：使用 fetch + ReadableStream
      const response = await fetch(`http://127.0.0.1:${status.port}/llm/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: masked,
          stream: true,
        }),
      })

      if (!response.ok || !response.body) {
        return `[错误] HTTP ${response.status}`
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            try {
              const parsed = JSON.parse(data)
              if (parsed.content) {
                fullContent += parsed.content
                if (window && !window.isDestroyed()) {
                  window.webContents.send(IPC_CHANNELS.AI_CHAT_STREAM_CHUNK, parsed.content)
                }
              }
              if (parsed.done) {
                // 记录用量（Python 端在 done 事件附带 usage）
                const usage = parsed.usage || {}
                try {
                  createUsageLog(convId, null, usage.prompt_tokens || 0, usage.completion_tokens || 0)
                } catch (e) {
                  console.error('记录用量失败:', e)
                }
                if (window && !window.isDestroyed()) {
                  window.webContents.send(IPC_CHANNELS.AI_CHAT_STREAM_DONE, fullContent)
                }
              }
            } catch {
              // 跳过解析失败的 chunk
            }
          }
        }
      }

      return fullContent
    } catch (err) {
      return `[错误] ${(err as Error).message}`
    }
  })

  // ---- RAG 问答 ----
  ipcMain.handle(IPC_CHANNELS.AI_RAG_QUERY, async (_event, query: string, context?: string) => {
    try {
      const status = await pythonBridge.getStatus()
      if (!status.running) {
        return { answer: 'Python 服务未启动', sources: [] }
      }

      const result = await pythonBridge.post<{
        answer: string
        sources: unknown[]
        usage?: { prompt_tokens: number; completion_tokens: number }
      }>('/llm/rag-ask', { question: query, top_k: 5 })

      // 记录 usage log
      try {
        createUsageLog(
          null,
          null,
          result.usage?.prompt_tokens || 0,
          result.usage?.completion_tokens || 0
        )
      } catch (e) {
        console.error('记录用量失败:', e)
      }

      return result
    } catch (err) {
      return { answer: `[错误] ${(err as Error).message}`, sources: [] }
    }
  })

  // ---- 生成报告 ----
  ipcMain.handle(
    IPC_CHANNELS.AI_GENERATE_REPORT,
    async (_event, template: string, data: unknown) => {
      try {
        const status = await pythonBridge.getStatus()
        if (!status.running) {
          return 'Python 服务未启动'
        }

        const d = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
        const result = await pythonBridge.post<{
          content: string
          usage?: { prompt_tokens: number; completion_tokens: number }
        }>('/llm/report', {
          // 不能兜底 String(data)：materials_text 为空时会产生 "[object Object]" 混进提示词
          materials_text: d.materials_text || '',
          risk_points: d.risk_points || '',
          report_type: template,
          target_company: d.target_company || '',
          client: d.client || '',
          scope: d.scope || '',
        })

        try {
          createUsageLog(
            null,
            null,
            result.usage?.prompt_tokens || 0,
            result.usage?.completion_tokens || 0
          )
        } catch (e) {
          console.error('记录用量失败:', e)
        }
        return result.content
      } catch (err) {
        return `[错误] ${(err as Error).message}`
      }
    }
  )

  // ---- SWOT 分析（透传全部字段：timelines/parties/dispute_focus/matched_laws/suggestions/_related_laws） ----
  ipcMain.handle(IPC_CHANNELS.AI_SWOT_ANALYSIS, async (_event, facts: string) => {
    try {
      const status = await pythonBridge.getStatus()
      if (!status.running) {
        return {
          strengths: [], weaknesses: [], opportunities: [], threats: [],
          analysis: 'Python 服务未启动',
        }
      }

      const result = await pythonBridge.post<Record<string, unknown>>('/llm/strategy', {
        facts_text: facts,
      })

      const usage = result.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
      try {
        createUsageLog(null, null, usage?.prompt_tokens || 0, usage?.completion_tokens || 0)
      } catch (e) {
        console.error('记录用量失败:', e)
      }

      return {
        strengths: result.strengths || [],
        weaknesses: result.weaknesses || [],
        opportunities: result.opportunities || [],
        threats: result.threats || [],
        analysis: result.analysis || '',
        timelines: result.timelines || [],
        parties: result.parties || [],
        dispute_focus: result.dispute_focus || [],
        matched_laws: result.matched_laws || [],
        suggestions: result.suggestions || [],
        _related_laws: result._related_laws || [],
      }
    } catch (err) {
      return {
        strengths: [], weaknesses: [], opportunities: [], threats: [],
        analysis: `[错误] ${(err as Error).message}`,
      }
    }
  })

  // ---- 知识库 ----
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_STATUS, async () => {
    try {
      const status = await pythonBridge.getStatus()
      if (!status.running) {
        return { doc_count: 0, ok: false, error: 'Python 服务未启动' }
      }
      return await pythonBridge.get<{ doc_count: number; ok: boolean; error?: string }>(
        '/knowledge/status'
      )
    } catch (err) {
      return { doc_count: 0, ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_REBUILD, async () => {
    try {
      const status = await pythonBridge.getStatus()
      if (!status.running) {
        return { doc_count: 0, ok: false, error: 'Python 服务未启动' }
      }
      // 全量重建索引是同步长任务，设置较长超时
      return await pythonBridge.post<{
        doc_count: number
        law_count: number
        material_count: number
        message: string
      }>('/knowledge/rebuild', {})
    } catch (err) {
      return { doc_count: 0, ok: false, error: (err as Error).message }
    }
  })

  // ---- 对话管理 ----
  ipcMain.handle('ai:create-conversation', (_event, title?: string, convType?: string) => {
    return createConversation(title, convType)
  })

  ipcMain.handle('ai:list-conversations', () => {
    return listConversations()
  })

  ipcMain.handle(
    'ai:save-message',
    (_event, convId: string, messagesJson: string, tokens: number) => {
      updateConversationMessages(convId, messagesJson, tokens)
    }
  )

  ipcMain.handle('ai:delete-conversation', (_event, convId: string) => {
    deleteConversation(convId)
  })

  // ---- 使用统计 ----
  ipcMain.handle('ai:usage-stats', (_event, period: 'today' | 'week' | 'month') => {
    return getUsageStats(period)
  })

  // ---- 隐私预览 ----
  ipcMain.handle(IPC_CHANNELS.AI_PRIVACY_PREVIEW, async (_event, text: string, level?: string) => {
    try {
      const status = await pythonBridge.getStatus()
      if (!status.running) {
        return { ok: false, message: 'Python 服务未启动' }
      }
      return await pythonBridge.post<{ ok: boolean; preview?: unknown[]; message?: string }>(
        '/llm/privacy/preview',
        { text, level: level || 'standard' }
      )
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  })
}
