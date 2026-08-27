import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { registerSystemIpc } from './system.ipc'
import { registerLawIpc } from './law.ipc'
import { registerCaseIpc } from './case.ipc'
import { registerFileIpc } from './file.ipc'
import { registerMaterialIpc } from './material.ipc'
import { registerAiIpc } from './ai.ipc'

export function registerAllIpcHandlers(): void {
  registerSystemIpc()
  registerLawIpc()
  registerCaseIpc()
  registerFileIpc()
  registerMaterialIpc()
  registerAiIpc()
}
