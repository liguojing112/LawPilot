import { ipcMain, dialog, BrowserWindow } from 'electron'
import { statSync } from 'fs'
import { basename } from 'path'
import { createHash } from 'crypto'
import { IPC_CHANNELS } from '../../../shared/types'

export function registerFileIpc(): void {
  ipcMain.handle(IPC_CHANNELS.FILE_SELECT, async (_event, options?: {
    filters?: { name: string; extensions: string[] }[]
  }) => {
    const window = BrowserWindow.getFocusedWindow()
    if (!window) return null

    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      filters: options?.filters || [
        { name: '法规文件', extensions: ['txt', 'md', 'text'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })

    if (result.canceled) return null
    return result.filePaths
  })

  ipcMain.handle(IPC_CHANNELS.FILE_GET_INFO, (_event, filePath: string) => {
    const stats = statSync(filePath)
    const content = require('fs').readFileSync(filePath)
    const hash = createHash('sha256').update(content).digest('hex')

    return {
      name: basename(filePath),
      size: stats.size,
      hash,
    }
  })

  // 读取图片文件为 data URL（用于预览），限制 20MB 避免撑爆渲染进程内存
  ipcMain.handle(IPC_CHANNELS.FILE_READ_IMAGE, (_event, filePath: string) => {
    try {
      const fs = require('fs')
      const stats = fs.statSync(filePath)
      if (stats.size > 20 * 1024 * 1024) {
        return null
      }
      const buf = fs.readFileSync(filePath)
      const ext = require('path').extname(filePath).toLowerCase()
      const mime =
        ext === '.png' ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.gif' ? 'image/gif'
        : ext === '.webp' ? 'image/webp'
        : ext === '.tiff' || ext === '.tif' ? 'image/tiff'
        : 'application/octet-stream'
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  })
}
