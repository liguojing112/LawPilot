import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import {
  createCase,
  listCases,
  countCases,
  getCaseById,
  updateCase,
  deleteCase,
  createActivity,
  getActivitiesByCase,
  listMaterialsByCase,
} from '../services/database'
import { pythonBridge } from '../services/python-bridge'

export function registerCaseIpc(): void {
  ipcMain.handle(IPC_CHANNELS.CASE_CREATE, (_event, data) => {
    const c = createCase(data)
    createActivity(c.id, 'case_created', `创建了案件"${c.title}"`)
    return c
  })

  ipcMain.handle(IPC_CHANNELS.CASE_LIST, (_event, filters) => {
    return listCases(filters || {})
  })

  ipcMain.handle(IPC_CHANNELS.CASE_COUNT, () => {
    return countCases()
  })

  ipcMain.handle(IPC_CHANNELS.CASE_GET, (_event, id: string) => {
    return getCaseById(id) || null
  })

  ipcMain.handle(IPC_CHANNELS.CASE_UPDATE, (_event, id: string, data) => {
    const updated = updateCase(id, data)
    if (updated) {
      createActivity(id, 'case_updated', `更新了案件信息`)
    }
    return updated || null
  })

  ipcMain.handle(IPC_CHANNELS.CASE_DELETE, (_event, id: string) => {
    deleteCase(id)
  })

  // 获取案件动态
  ipcMain.handle(IPC_CHANNELS.CASE_GET_ACTIVITIES, (_event, caseId: string) => {
    return getActivitiesByCase(caseId)
  })

  // 导出案件（ZIP/PDF）
  ipcMain.handle(IPC_CHANNELS.CASE_EXPORT, async (_event, data: { caseId: string; format: string }) => {
    const c = getCaseById(data.caseId)
    if (!c) throw new Error('案件不存在')

    const win = BrowserWindow.getFocusedWindow()

    if (data.format === 'zip') {
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: `${c.case_number || '案件'}_${c.title}.zip`,
        filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
      })
      if (result.canceled) return null
      const savePath = result.filePath

      const fs = require('fs') as typeof import('fs')
      const path = require('path') as typeof import('path')
      const archiverMod = await import('archiver')
      const raw = archiverMod.default ?? archiverMod
      const archiverFn = typeof raw === 'function' ? raw : (raw as any).default ?? raw

      const materials = listMaterialsByCase(data.caseId)

      return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(savePath)
        const archive = archiverFn('zip', { zlib: { level: 9 } })

        output.on('close', () => {
          createActivity(data.caseId, 'case_exported', `导出案件 ZIP (${materials.length} 份材料): ${savePath}`)
          resolve(savePath)
        })
        archive.on('error', (err: Error) => reject(err))
        archive.pipe(output)

        const categoryOrder = ['起诉状', '答辩状', '证据', '判决', '裁定', '合同', '其他']
        const sorted = [...materials].sort((a, b) => {
          const ia = categoryOrder.indexOf(a.category)
          const ib = categoryOrder.indexOf(b.category)
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
        })

        sorted.forEach((m, i) => {
          const prefix = String(i + 1).padStart(2, '0')
          const ext = path.extname(m.original_name)
          const zipName = `${prefix}-${m.category || '其他'}-${m.original_name}`

          if (fs.existsSync(m.stored_path)) {
            archive.file(m.stored_path, { name: zipName })
          }

          if (m.raw_text) {
            const txtName = `${prefix}-${m.category || '其他'}-${path.basename(m.original_name, ext)}.txt`
            archive.append(m.raw_text, { name: `文本提取/${txtName}` })
          }
        })

        let manifest = `${c.case_number || ''} ${c.title}\n`
        manifest += `管辖法院: ${c.court || '-'}\n`
        manifest += `立案日期: ${c.filing_date || '-'}\n`
        manifest += `导出日期: ${new Date().toLocaleString('zh-CN')}\n\n`
        manifest += `=== 材料清单 (${materials.length} 份) ===\n\n`
        sorted.forEach((m, i) => {
          manifest += `[${String(i + 1).padStart(2, '0')}] ${m.category || '其他'} - ${m.original_name}\n`
        })
        archive.append(manifest, { name: '案件清单.txt' })

        archive.finalize()
      })
    }

    // PDF 导出
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `${c.case_number || '案件'}_${c.title}.pdf`,
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    })
    if (result.canceled) return null
    const savePath = result.filePath

    const materials = listMaterialsByCase(data.caseId)

    try {
      await pythonBridge.post('/export/pdf', {
        case_id: data.caseId,
        case_number: c.case_number,
        title: c.title,
        court: c.court,
        filing_date: c.filing_date,
        save_path: savePath,
        materials: materials.map((m) => ({
          original_name: m.original_name,
          category: m.category,
          raw_text: m.raw_text || null,
        })),
      })
      createActivity(data.caseId, 'case_exported', `导出案件为 PDF: ${savePath}`)
      return savePath
    } catch {
      const { jsPDF } = require('jspdf') as typeof import('jspdf')
      const doc = new jsPDF()

      // 封面
      doc.setFontSize(22)
      doc.text('电子卷宗', 105, 60, { align: 'center' })
      doc.setFontSize(12)
      const info = [
        ['案号', c.case_number || '-'],
        ['案由', c.title],
        ['管辖法院', c.court || '-'],
        ['立案日期', c.filing_date || '-'],
        ['材料数量', `${materials.length} 份`],
      ]
      info.forEach(([label, value], i) => {
        doc.text(`${label}: ${value}`, 30, 90 + i * 10)
      })

      // 材料列表
      doc.addPage()
      doc.setFontSize(14)
      doc.text('目　录', 105, 20, { align: 'center' })
      materials.forEach((m, i) => {
        doc.setFontSize(11)
        doc.text(`${i + 1}. [${m.category}] ${m.original_name}`, 20, 35 + i * 8)
      })

      // 材料正文
      materials.forEach((m) => {
        doc.addPage()
        doc.setFontSize(14)
        doc.text(m.original_name, 20, 20)
        doc.setFontSize(10)
        doc.text(`分类: ${m.category}`, 20, 28)

        if (m.raw_text) {
          const lines = doc.splitTextToSize(m.raw_text, 170)
          doc.setFontSize(10)
          doc.text(lines, 20, 40)
        } else {
          doc.setFontSize(10)
          doc.text('（无文本内容）', 20, 40)
        }
      })

      const buffer = Buffer.from(doc.output('arraybuffer'))
      require('fs').writeFileSync(savePath, buffer)
      createActivity(data.caseId, 'case_exported', `导出案件为 PDF: ${savePath}`)
      return savePath
    }
  })
}
