import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type LawPilotAPI,
  type PythonStatus,
  type DbStatus,
  type SearchResult,
  type Revision,
} from '../../shared/types'

const api: LawPilotAPI = {
  system: {
    ping: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_PING),
    dbStatus: () => ipcRenderer.invoke(IPC_CHANNELS.DB_STATUS),
    getConfig: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_GET_CONFIG, key),
    setConfig: (key: string, value: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SET_CONFIG, key, value),
    pythonStatus: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_PYTHON_STATUS),
  },

  law: {
    search: (query: string, limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.LAW_SEARCH, query, limit),
    list: (params) => ipcRenderer.invoke(IPC_CHANNELS.LAW_LIST, params),
    count: () => ipcRenderer.invoke(IPC_CHANNELS.LAW_COUNT),
    import: (files: string[]) => ipcRenderer.invoke(IPC_CHANNELS.LAW_IMPORT, files),
    getById: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.LAW_GET_BY_ID, id),
    export: (ids: string[], format: 'pdf' | 'docx') =>
      ipcRenderer.invoke(IPC_CHANNELS.LAW_EXPORT, ids, format),
    compare: (id1: string, id2: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.LAW_COMPARE, id1, id2),
    getRevisions: (lawId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.LAW_GET_REVISIONS, lawId),
    addRevision: (data) =>
      ipcRenderer.invoke(IPC_CHANNELS.LAW_ADD_REVISION, data),
    getRevision: (revisionId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.LAW_GET_REVISION, revisionId),
  },

  case: {
    list: (filters) => ipcRenderer.invoke(IPC_CHANNELS.CASE_LIST, filters),
    count: () => ipcRenderer.invoke(IPC_CHANNELS.CASE_COUNT),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CASE_GET, id),
    create: (data) => ipcRenderer.invoke(IPC_CHANNELS.CASE_CREATE, data),
    update: (id: string, data) => ipcRenderer.invoke(IPC_CHANNELS.CASE_UPDATE, id, data),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CASE_DELETE, id),
    exportCase: (data) => ipcRenderer.invoke(IPC_CHANNELS.CASE_EXPORT, data),
    getActivities: (caseId: string) => ipcRenderer.invoke(IPC_CHANNELS.CASE_GET_ACTIVITIES, caseId),
  },

  material: {
    import: (filePaths: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.MATERIAL_IMPORT, filePaths),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MATERIAL_GET, id),
    listByCase: (caseId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MATERIAL_LIST_BY_CASE, caseId),
    linkToCase: (materialId: string, caseId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MATERIAL_LINK_CASE, materialId, caseId),
    classify: (materialId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MATERIAL_CLASSIFY, materialId),
    latest: (limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.MATERIAL_LATEST, limit || 5),
    delete: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.MATERIAL_DELETE, id),
    updateOrder: (caseId: string, orderedIds: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.MATERIAL_UPDATE_ORDER, caseId, orderedIds),
    onProcessed: (callback: (data: {
      materialId: string
      status: string
      category?: string
      error?: string
      suggestedCaseNumber?: string
    }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.MATERIAL_PROCESSED, handler)
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.MATERIAL_PROCESSED, handler) }
    },
  },

  ai: {
    chat: (convId, message) => ipcRenderer.invoke(IPC_CHANNELS.AI_CHAT, convId, message),
    onStreamChunk: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, chunk: string) => callback(chunk)
      ipcRenderer.on(IPC_CHANNELS.AI_CHAT_STREAM_CHUNK, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.AI_CHAT_STREAM_CHUNK, handler)
      }
    },
    offStreamChunk: () => {
      ipcRenderer.removeAllListeners(IPC_CHANNELS.AI_CHAT_STREAM_CHUNK)
    },
    ragQuery: (query, context) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_RAG_QUERY, query, context),
    generateReport: (template, data) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_GENERATE_REPORT, template, data),
    swotAnalysis: (facts) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_SWOT_ANALYSIS, facts),
  },

  file: {
    select: (options) => ipcRenderer.invoke(IPC_CHANNELS.FILE_SELECT, options),
    getInfo: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_GET_INFO, filePath),
  },
}

contextBridge.exposeInMainWorld('api', api)
