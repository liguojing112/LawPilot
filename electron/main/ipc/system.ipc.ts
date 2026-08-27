import { ipcMain } from 'electron'
import { IPC_CHANNELS, type PythonStatus } from '../../../shared/types'
import { pythonBridge } from '../services/python-bridge'
import { getDatabaseStatus, getConfigValue, setConfigValue } from '../services/database'

export function registerSystemIpc(): void {
  ipcMain.handle(IPC_CHANNELS.SYSTEM_PING, () => {
    return 'pong'
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_PYTHON_STATUS, async (): Promise<PythonStatus> => {
    return pythonBridge.getStatus()
  })

  ipcMain.handle(IPC_CHANNELS.DB_STATUS, () => {
    return getDatabaseStatus()
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_GET_CONFIG, (_event, key: string) => {
    return getConfigValue(key)
  })

  ipcMain.handle(IPC_CHANNELS.SYSTEM_SET_CONFIG, (_event, key: string, value: string) => {
    setConfigValue(key, value)
  })
}
