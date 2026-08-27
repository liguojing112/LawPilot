/// <reference types="vite/client" />

// Electron 渲染进程中 File 对象额外携带本地完整路径
interface File {
  path?: string
}
