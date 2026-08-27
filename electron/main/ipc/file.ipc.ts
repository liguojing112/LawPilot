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
}
