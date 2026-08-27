import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { pythonBridge } from '../services/python-bridge'
import {
  createConversation,
  updateConversationMessages,
  listConversations,
  createUsageLog,
  getUsageStats,
  type ConvRow,
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
  ipcMain.handle(IPC_CHANNELS.AI_CHAT, async (event, convId: string, message: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    try {
      // 脱敏
      const masked = quickMask(message)

      // 调用 Python LLM 流式端点
      const status = await pythonBridge.getStatus()
      if (!status.running) {
        return 'Python 服务未启动，请先启动 Python 服务'
      }

      // 流式调用：使用 fetch + ReadableStream
      const response = await fetch(`http://127.0.0.1:${status.port}/llm/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: masked }],
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

      const result = await pythonBridge.post<{ answer: string; sources: unknown[] }>(
        '/llm/rag-ask',
        { question: query, top_k: 5 }
      )

      // 记录 usage log
      createUsageLog(null, null, 0, 0)

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

        const result = await pythonBridge.post<{ content: string }>('/llm/report', {
          materials_text: typeof data === 'object' && (data as any)?.materials_text || String(data),
          risk_points: typeof data === 'object' ? (data as any)?.risk_points || '' : '',
          report_type: template,
        })
        return result.content
      } catch (err) {
        return `[错误] ${(err as Error).message}`
      }
    }
  )

  // ---- SWOT 分析 ----
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

      return {
        strengths: result.strengths || [],
        weaknesses: result.weaknesses || [],
        opportunities: result.opportunities || [],
        threats: result.threats || [],
        analysis: result.analysis || '',
      }
    } catch (err) {
      return {
        strengths: [], weaknesses: [], opportunities: [], threats: [],
        analysis: `[错误] ${(err as Error).message}`,
      }
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

  // ---- 使用统计 ----
  ipcMain.handle('ai:usage-stats', (_event, period: 'today' | 'week' | 'month') => {
    return getUsageStats(period)
  })
}
