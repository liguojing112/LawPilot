import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { ChildProcess, spawn } from 'child_process'
import { PythonStatus } from '../../../shared/types'

const log = {
  info: (...a: unknown[]) => console.log('[PythonBridge]', ...a),
  warn: (...a: unknown[]) => console.warn('[PythonBridge]', ...a),
  error: (...a: unknown[]) => console.error('[PythonBridge]', ...a),
  debug: (...a: unknown[]) => console.log('[PythonBridge]', ...a),
}

class PythonBridge {
  private port = 18920
  private baseUrl: string
  private process: ChildProcess | null = null
  private restartCount = 0
  private maxRestarts = 3
  private restartDelay = 2000
  private onStatusChange?: (status: PythonStatus) => void

  constructor() {
    this.port = parseInt(process.env.PYTHON_PORT || '18920', 10)
    this.baseUrl = `http://127.0.0.1:${this.port}`
  }

  /** 获取可执行路径（开发/生产） */
  private getExecutableInfo(): { exe: string; args: string[]; cwd?: string } | null {
    // 开发环境：假设手动启动
    if (!app.isPackaged) {
      log.info('[PythonBridge] 开发模式，跳过自动启动')
      return null
    }

    // 生产环境：优先找 PyInstaller 打包的 EXE
    const resourcesPath = process.resourcesPath
    const backendExe = join(resourcesPath, 'python', 'lawpilot-backend.exe')
    const pythonExe = join(resourcesPath, 'python', 'python.exe')

    try {
      const { existsSync } = require('fs')
      if (existsSync(backendExe)) {
        return { exe: backendExe, args: [], cwd: join(resourcesPath, 'python') }
      }
      if (existsSync(pythonExe)) {
        return {
          exe: pythonExe,
          args: ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(this.port)],
          cwd: join(resourcesPath, 'python'),
        }
      }
    } catch {
      // 忽略
    }

    // 不存在的回退：尝试全局 python，cwd 指向 python 目录以便找到 app/main.py
    return {
      exe: 'python',
      args: ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(this.port)],
      cwd: join(resourcesPath, 'python'),
    }
  }

  /** 构造子进程环境：生产模式下把可写数据指向用户目录，模型指向安装包内置目录 */
  private buildEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      LAWPILOT_PYTHON_PORT: String(this.port),
    }
    if (!app.isPackaged) return env

    const userDir = join(app.getPath('userData'), 'LawPilot')
    try { mkdirSync(userDir, { recursive: true }) } catch { /* 忽略 */ }
    env.LAWPILOT_DATA_DIR = userDir
    // 内嵌运行时随包位于 resources/python/，模型在其 data/ 下
    env.LAWPILOT_MODEL_DIR = join(process.resourcesPath, 'python', 'data', 'models')
    env.PADDLEX_HOME = join(process.resourcesPath, 'python', 'data', 'paddlex')
    // 模型已内置，禁止 HuggingFace 联网检查（离线可用）
    env.HF_HUB_OFFLINE = '1'
    env.TRANSFORMERS_OFFLINE = '1'
    return env
  }

  /** 启动 Python 子进程 */
  async start(): Promise<void> {
    const info = this.getExecutableInfo()
    if (!info) {
      log.info('[PythonBridge] 跳过启动（开发模式或未打包）')
      return
    }

    if (this.process) {
      log.warn('[PythonBridge] 进程已在运行')
      return
    }

    log.info(`[PythonBridge] 启动: ${info.exe} ${info.args.join(' ')}`)
    this.process = spawn(info.exe, info.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: info.cwd,
      env: this.buildEnv(),
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      log.debug(`[PythonBridge] stdout: ${data.toString().slice(0, 200)}`)
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      log.warn(`[PythonBridge] stderr: ${data.toString().slice(0, 200)}`)
    })

    this.process.on('error', (err: Error) => {
      log.error('[PythonBridge] 进程错误', err)
      this.process = null
      this.attemptRestart()
    })

    this.process.on('exit', (code: number | null, signal: string | null) => {
      log.warn(`[PythonBridge] 进程退出 code=${code} signal=${signal}`)
      this.process = null
      if (code !== 0 && code !== null) {
        this.attemptRestart()
      }
    })

    // 等待就绪
    await this.waitUntilReady(30000)
    log.info('[PythonBridge] 启动完成')
  }

  /** 停止子进程 */
  async stop(): Promise<void> {
    if (!this.process) return

    log.info('[PythonBridge] 停止进程')
    this.restartCount = this.maxRestarts // 阻止自动重启

    return new Promise<void>((resolve) => {
      if (!this.process) { resolve(); return }

      const cleanup = () => {
        if (this.process) {
          try { this.process.kill('SIGKILL') } catch { /* 忽略 */ }
          this.process = null
        }
        resolve()
      }

      this.process.once('exit', cleanup)
      try { this.process.kill('SIGTERM') } catch { cleanup() }

      // 超时强制杀
      setTimeout(cleanup, 5000)
    })
  }

  /** 自动重启 */
  private attemptRestart(): void {
    if (this.restartCount >= this.maxRestarts) {
      log.error('[PythonBridge] 达到最大重启次数，停止重试')
      this.notifyStatus({ running: false, port: this.port, version: null, error: '服务已断开，请重启应用' })
      return
    }

    this.restartCount++
    const delay = this.restartDelay * Math.pow(2, this.restartCount - 1)
    log.info(`[PythonBridge] ${delay}ms 后第 ${this.restartCount} 次重启...`)

    setTimeout(() => {
      this.process = null
      this.start()
    }, delay)
  }

  /** 轮询 /health 直到就绪 */
  private async waitUntilReady(timeout: number): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      const status = await this.getStatus()
      if (status.running) {
        this.restartCount = 0 // 重置计数器
        this.notifyStatus(status)
        return
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    log.warn('[PythonBridge] 等待就绪超时')
    this.notifyStatus({ running: false, port: this.port, version: null, error: '启动超时' })
  }

  /** 通知状态变更 */
  private notifyStatus(status: PythonStatus): void {
    this.onStatusChange?.(status)
  }

  /** 设置状态回调 */
  setStatusCallback(cb: (status: PythonStatus) => void): void {
    this.onStatusChange = cb
  }

  /** 健康检查 */
  async getStatus(): Promise<PythonStatus> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)
      const response = await fetch(`${this.baseUrl}/health`, { signal: controller.signal })
      clearTimeout(timeoutId)
      if (response.ok) {
        const data = await response.json()
        return { running: true, port: this.port, version: data.version || null, error: null }
      }
      return { running: false, port: this.port, version: null, error: `HTTP ${response.status}` }
    } catch (err) {
      return { running: false, port: this.port, version: null, error: (err as Error).message }
    }
  }

  /** 通用 POST */
  async post<T>(endpoint: string, body: unknown, timeoutMs = 120_000): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      log.info(`POST ${endpoint} (timeout=${timeoutMs}ms)`)
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`Python service error: ${response.status} ${response.statusText} ${text}`)
      }
      return response.json() as Promise<T>
    } catch (err) {
      clearTimeout(timer)
      log.error(`POST ${endpoint} failed:`, (err as Error).message)
      throw err
    }
  }

  /** 通用 GET */
  async get<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`)
    if (!response.ok) {
      throw new Error(`Python service error: ${response.status} ${response.statusText}`)
    }
    return response.json() as Promise<T>
  }
}

export const pythonBridge = new PythonBridge()
