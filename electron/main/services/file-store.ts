import { app } from 'electron'
import { join, dirname, extname } from 'path'
import { existsSync, mkdirSync, copyFileSync, readFileSync, statSync } from 'fs'
import { createHash } from 'crypto'

/** 计算文件 SHA-256 */
export function computeHash(filePath: string): string {
  const buffer = readFileSync(filePath)
  return createHash('sha256').update(buffer).digest('hex')
}

/** 获取存储目录 */
function getStoreDir(): string {
  const dir = join(app.getPath('userData'), 'LawPilot', 'files')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** 获取文件 MIME 类型 */
function guessMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
  }
  return map[ext.toLowerCase()] || 'application/octet-stream'
}

/** 将文件复制到本地存储，基于哈希去重 */
export function storeFile(sourcePath: string): {
  storedPath: string
  hash: string
  size: number
} {
  const hash = computeHash(sourcePath)
  const ext = extname(sourcePath)
  const prefix = hash.slice(0, 2)
  const storeDir = getStoreDir()
  const prefixDir = join(storeDir, prefix)

  if (!existsSync(prefixDir)) {
    mkdirSync(prefixDir, { recursive: true })
  }

  const storedPath = join(prefixDir, `${hash}${ext}`)

  // 哈希去重：文件已存在则不重复复制
  if (!existsSync(storedPath)) {
    copyFileSync(sourcePath, storedPath)
  }

  const { size } = statSync(storedPath)
  return { storedPath, hash, size }
}

/** 根据哈希和原始扩展名反查存储路径 */
export function getStoredFilePath(hash: string, originalName: string): string {
  const ext = extname(originalName)
  const prefix = hash.slice(0, 2)
  return join(getStoreDir(), prefix, `${hash}${ext}`)
}

/** 检查哈希对应的文件是否已存储 */
export function fileExists(hash: string, originalName: string): boolean {
  return existsSync(getStoredFilePath(hash, originalName))
}

/** 获取文件扩展名对应的 MIME */
export { guessMimeType }
