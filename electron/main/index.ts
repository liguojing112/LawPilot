import { app, BrowserWindow, shell, dialog, protocol, net, Menu } from 'electron'
import { join } from 'path'
import { registerAllIpcHandlers } from './ipc'
import { pythonBridge } from './services/python-bridge'

const log = {
  info: (...a: unknown[]) => console.log('[Main]', ...a),
  warn: (...a: unknown[]) => console.warn('[Main]', ...a),
  error: (...a: unknown[]) => console.error('[Main]', ...a),
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'LawPilot',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发模式：加载 Vite dev server（支持 HMR）；生产模式：加载静态构建产物
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    log.info('[Main] Loading renderer from dev server:', devUrl)
    mainWindow.loadURL(devUrl)
  } else {
    // 生产模式：使用自定义协议加载 renderer
    // 这样可以避免 file:// 协议不支持 ES module 的问题
    const rendererPath = join(__dirname, '../renderer/index.html')
    log.info('[Main] Loading renderer from:', rendererPath)
    mainWindow.loadFile(rendererPath)
  }

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools()
  }
}

// 全局异常捕获
process.on('uncaughtException', (error) => {
  log.error('uncaughtException', error)
  try {
    dialog.showErrorBox('程序错误', `${error.message}\n\n详细信息已记录到日志文件。`)
  } catch { /* ignore */ }
})

process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', reason)
})

app.whenReady().then(async () => {
  // 隐藏默认菜单栏 (File/Edit/View/Window/Help)
  // 导航功能已移至应用内顶部导航栏
  Menu.setApplicationMenu(null)

  // 注册自定义 protocol 以支持 ES module CORS
  // 这样 file:// 下的 script type="module" 就不会报 CORS 错误了
  protocol.handle('lawpilot-app', (request) => {
    const url = new URL(request.url)
    // 将 lawpilot-app:// 路径映射到实际文件系统路径
    const filePath = join(__dirname, '..', url.pathname)
    return net.fetch('file://' + filePath)
  })

  registerAllIpcHandlers()
  createWindow()

  try {
    await pythonBridge.start()
  } catch (err) {
    log.warn('[Main] Python 启动失败（可能是开发模式）:', (err as Error).message)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    await pythonBridge.stop()
    app.quit()
  }
})
