import { ipcMain, BrowserWindow } from 'electron'
import { readFileSync } from 'fs'
import { extname } from 'path'
import { IPC_CHANNELS } from '../../../shared/types'
import {
  createMaterial,
  getMaterialById,
  listMaterialsByCase,
  listAllMaterials,
  linkMaterialToCase,
  updateMaterialOcr,
  updateMaterialCategory,
  updateMaterialEvidence,
  deleteMaterial,
  createActivity,
  getCaseById,
  type MaterialRow,
} from '../services/database'
import { updateCase } from '../services/database'
import { storeFile, guessMimeType } from '../services/file-store'
import { pythonBridge } from '../services/python-bridge'

/** 允许拖放的文件扩展名 */
const ALLOWED_EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.doc', '.docx', '.txt', '.md']

/** 从材料文本中提取案号 */
function extractCaseNumber(text: string): string | null {
  const pattern = /[（(]\d{4}[）)][一-龥]{2,10}[民刑行执]初?终?字?第?\d+号/g
  const match = text.match(pattern)
  return match ? match[0] : null
}

export function registerMaterialIpc(): void {
  // ---- 导入材料 ----
  ipcMain.handle(
    IPC_CHANNELS.MATERIAL_IMPORT,
    async (_event, filePaths: string[]) => {
      const results: Array<{ material: MaterialRow | null; error?: string }> = []
      const window = BrowserWindow.getAllWindows()[0]

      for (let i = 0; i < filePaths.length; i++) {
        const fp = filePaths[i]
        try {
          const ext = extname(fp).toLowerCase()
          if (!ALLOWED_EXTS.includes(ext)) {
            results.push({ material: null, error: `不支持的文件格式: ${ext}` })
            continue
          }

          // 存储文件
          const { storedPath, hash, size } = storeFile(fp)
          const mime = guessMimeType(ext)

          // 创建数据库记录
          const material = createMaterial({
            original_name: fp.split(/[\\/]/).pop() || fp,
            stored_path: storedPath,
            file_hash: hash,
            mime_type: mime,
            file_size: size,
          })

          results.push({ material })

          // 异步执行 OCR/文本提取
          processMaterialAsync(material.id, fp, ext, window)
        } catch (err) {
          results.push({ material: null, error: (err as Error).message })
        }

        // 发送进度
        if (window) {
          window.webContents.send(IPC_CHANNELS.MATERIAL_IMPORT_PROGRESS, {
            current: i + 1,
            total: filePaths.length,
          })
        }
      }

      return results
    }
  )

  /** 异步处理材料（OCR / 文本提取） */
  async function processMaterialAsync(
    materialId: string,
    filePath: string,
    ext: string,
    window: BrowserWindow | null
  ): Promise<void> {
    try {
      // 文本文件直接读取
      if (ext === '.txt' || ext === '.md') {
        const text = readFileSync(filePath, 'utf-8')
        updateMaterialOcr(materialId, text, 'done')

        // 自动分类
        const category = autoClassifyText(materialId, text)
        const caseNum = extractCaseNumber(text)
        if (window) {
          window.webContents.send(IPC_CHANNELS.MATERIAL_PROCESSED, {
            materialId,
            status: 'done',
            category,
            suggestedCaseNumber: caseNum,
          })
        }
        return
      }

      // 图片/PDF/Word 通过 Python OCR
      updateMaterialOcr(materialId, '', 'processing')
      const status = await pythonBridge.getStatus()

      if (!status.running) {
        updateMaterialOcr(materialId, '', 'error', 'Python 服务未启动')
        if (window) {
          window.webContents.send(IPC_CHANNELS.MATERIAL_PROCESSED, {
            materialId,
            status: 'error',
            error: 'Python 服务未启动，请先启动 Python 服务',
          })
        }
        return
      }

      const result = await pythonBridge.post<{ text: string; page_count: number }>(
        '/ocr/extract',
        { file_path: filePath, file_type: ext.replace('.', '') }
      )

      updateMaterialOcr(materialId, result.text, 'done')

      // 自动分类
      const category = autoClassifyText(materialId, result.text)
      const caseNum = extractCaseNumber(result.text)

      if (window) {
        window.webContents.send(IPC_CHANNELS.MATERIAL_PROCESSED, {
          materialId,
          status: 'done',
          category,
          suggestedCaseNumber: caseNum,
        })
      }
    } catch (err) {
      updateMaterialOcr(materialId, '', 'error', (err as Error).message)
      if (window) {
        window.webContents.send(IPC_CHANNELS.MATERIAL_PROCESSED, {
          materialId,
          status: 'error',
          error: (err as Error).message,
        })
      }
    }
  }

  // ---- 关联材料到案件 ----
  ipcMain.handle(
    IPC_CHANNELS.MATERIAL_LINK_CASE,
    (_event, materialId: string, caseId: string) => {
      const material = getMaterialById(materialId)
      linkMaterialToCase(materialId, caseId)

      if (material && caseId) {
        const c = getCaseById(caseId)
        createActivity(
          caseId,
          'material_linked',
          `关联了材料"${material.original_name}"${c ? `到案件"${c.title}"` : ''}`
        )
      } else if (material && !caseId && material.case_id) {
        createActivity(
          material.case_id,
          'material_unlinked',
          `取消关联材料"${material.original_name}"`
        )
      }
    }
  )

  // ---- 获取案件下的材料列表 ----
  ipcMain.handle(
    IPC_CHANNELS.MATERIAL_LIST_BY_CASE,
    (_event, caseId: string) => {
      return listMaterialsByCase(caseId)
    }
  )

  // ---- 获取单个材料 ----
  ipcMain.handle(
    IPC_CHANNELS.MATERIAL_GET,
    (_event, materialId: string) => {
      return getMaterialById(materialId) || null
    }
  )

  // ---- 手动分类材料 ----
  ipcMain.handle(
    IPC_CHANNELS.MATERIAL_CLASSIFY,
    async (_event, materialId: string) => {
      const material = getMaterialById(materialId)
      if (!material || !material.raw_text) {
        return { category: '其他', confidence: 0 }
      }
      const prevCategory = material.category
      const category = autoClassifyText(materialId, material.raw_text)
      if (material.case_id && category.category !== prevCategory) {
        createActivity(
          material.case_id,
          'material_classified',
          `材料"${material.original_name}"分类更新为「${category.category}」（置信度 ${Math.round(category.confidence * 100)}%）`
        )
      }
      return category
    }
  )

  // ---- 获取最近上传的材料 ----
  ipcMain.handle(
    IPC_CHANNELS.MATERIAL_LATEST,
    (_event, limit?: number) => {
      return listAllMaterials(limit || 5)
    }
  )

  // ---- 删除材料 ----
  ipcMain.handle(
    IPC_CHANNELS.MATERIAL_DELETE,
    (_event, materialId: string) => {
      deleteMaterial(materialId)
    }
  )

  // ---- 更新卷宗材料排序 ----
  ipcMain.handle(
    IPC_CHANNELS.MATERIAL_UPDATE_ORDER,
    (_event, caseId: string, orderedIds: string[]) => {
      updateCase(caseId, { volume_order: JSON.stringify(orderedIds) })
      createActivity(caseId, 'volume_reordered', `调整了卷宗材料排序（${orderedIds.length} 份材料）`)
    }
  )

  // ---- 更新材料证据编号与证明目的 ----
  ipcMain.handle(
    IPC_CHANNELS.MATERIAL_UPDATE_EVIDENCE,
    (_event, materialId: string, evidenceNo: string, proofPurpose: string) => {
      const material = getMaterialById(materialId)
      updateMaterialEvidence(materialId, evidenceNo || '', proofPurpose || '')
      if (material?.case_id) {
        createActivity(
          material.case_id,
          'evidence_updated',
          `更新了材料"${material.original_name}"的证据信息（编号：${evidenceNo || '-'}）`
        )
      }
    }
  )
}

// ============== 本地规则引擎分类 ==============

const CATEGORY_RULES: Record<
  string,
  { keywords: string[]; patterns: RegExp[]; weight: number }
> = {
  '起诉状': {
    keywords: ['起诉状', '民事起诉状', '刑事自诉状', '行政起诉状', '具状人', '诉讼请求', '原告', '被告'],
    patterns: [/诉讼请求/, /事实与理由/],
    weight: 10,
  },
  '答辩状': {
    keywords: ['答辩状', '民事答辩状', '答辩人', '辩称'],
    patterns: [/答辩.*意见/],
    weight: 10,
  },
  '证据': {
    keywords: ['证据目录', '证据清单', '证据材料', '证据来源', '证明力'],
    patterns: [/证明目的/, /证据来源/],
    weight: 8,
  },
  '判决': {
    keywords: ['判决书', '民事判决书', '刑事判决书', '判决如下', '经审理查明', '本判决', '驳回'],
    patterns: [/本院认为/, /判决如下/],
    weight: 10,
  },
  '裁定': {
    keywords: ['裁定书', '民事裁定书', '裁定如下', '裁定驳回'],
    patterns: [/裁定如下/],
    weight: 10,
  },
  '合同': {
    keywords: ['合同', '协议', '甲方', '乙方', '签订日期', '违约责任', '合同争议'],
    patterns: [/甲方.*乙方/],
    weight: 7,
  },
}

/** 本地关键词+规则引擎自动分类，返回分类标签和置信度 */
function autoClassifyText(
  materialId: string,
  text: string
): { category: string; confidence: number } {
  const material = getMaterialById(materialId)
  if (!material) return { category: '其他', confidence: 0 }

  const fileName = material.original_name.toLowerCase()
  let bestCategory = '其他'
  let bestScore = 0

  for (const [category, rules] of Object.entries(CATEGORY_RULES)) {
    let score = 0
    let maxScore = 0

    // 文件名匹配（权重 ×2）
    for (const kw of rules.keywords) {
      if (fileName.includes(kw.toLowerCase())) {
        score += 2
      }
    }

    // 内容关键词匹配
    const lowerText = text.toLowerCase()
    for (const kw of rules.keywords) {
      maxScore += 1
      if (lowerText.includes(kw.toLowerCase())) {
        score += 1
      }
    }

    // 正则模式匹配
    for (const pat of rules.patterns) {
      maxScore += 2
      if (pat.test(text)) {
        score += 2
      }
    }

    const normalizedScore = maxScore > 0 ? score / maxScore : 0
    if (normalizedScore > bestScore) {
      bestScore = normalizedScore
      bestCategory = category
    }
  }

  const confidence = Math.min(bestScore, 0.99)
  updateMaterialCategory(materialId, bestCategory, confidence)
  return { category: bestCategory, confidence }
}
