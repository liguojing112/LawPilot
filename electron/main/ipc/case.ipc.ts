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

  ipcMain.handle(IPC_CHANNELS.CASE_GET_ACTIVITIES, (_event, caseId: string) => {
    return getActivitiesByCase(caseId)
  })

  // 导出案件（ZIP/PDF）
  ipcMain.handle(IPC_CHANNELS.CASE_EXPORT, async (_event, data: { caseId: string; format: string }) => {
    const c = getCaseById(data.caseId)
    if (!c) throw new Error('案件不存在')

    const win = BrowserWindow.getFocusedWindow()

    const materials = listMaterialsByCase(data.caseId)

    // 排序：优先用户保存的卷宗排序（volume_order），否则按分类默认排序
    let sorted: typeof materials | null = null
    if (c.volume_order) {
      try {
        const order: string[] = JSON.parse(c.volume_order)
        const byId = new Map(materials.map((m) => [m.id, m]))
        const ordered = order.map((id) => byId.get(id)).filter(Boolean) as typeof materials
        const rest = materials.filter((m) => !order.includes(m.id))
        if (ordered.length > 0) sorted = [...ordered, ...rest]
      } catch {
        // volume_order 解析失败，退回分类排序
      }
    }
    if (!sorted) {
      const categoryOrder = ['起诉状', '答辩状', '证据', '判决', '裁定', '合同', '其他']
      sorted = [...materials].sort((a, b) => {
        const ia = categoryOrder.indexOf(a.category)
        const ib = categoryOrder.indexOf(b.category)
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      })
    }

    if (data.format === 'zip') {
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: `${c.case_number || '案件'}_${c.title}.zip`,
        filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
      })
      if (result.canceled) return null
      const savePath = result.filePath

      const fs = require('fs') as typeof import('fs')
      const path = require('path') as typeof import('path')
      const { execSync } = require('child_process') as typeof import('child_process')
      const os = require('os') as typeof import('os')

      // 创建临时目录，复制文件后用 PowerShell 压缩
      const tmpDir = path.join(os.tmpdir(), `lawpilot-export-${Date.now()}`)
      const srcDir = path.join(tmpDir, '原始文件')
      const txtDir = path.join(tmpDir, '文本提取')
      fs.mkdirSync(srcDir, { recursive: true })
      fs.mkdirSync(txtDir, { recursive: true })

      try {
        sorted.forEach((m, i) => {
          const prefix = String(i + 1).padStart(2, '0')
          if (fs.existsSync(m.stored_path)) {
            fs.copyFileSync(m.stored_path, path.join(srcDir, `${prefix}-${m.original_name}`))
          }
          if (m.raw_text) {
            const baseName = path.basename(m.original_name, path.extname(m.original_name))
            fs.writeFileSync(path.join(txtDir, `${prefix}-${baseName}.txt`), m.raw_text, 'utf-8')
          }
        })

        // 案件清单
        let manifest = `${c.case_number || ''} ${c.title}\n`
        manifest += `管辖法院: ${c.court || '-'}\n`
        manifest += `委托人: ${c.client || '-'}\n`
        manifest += `立案日期: ${c.filing_date || '-'}\n`
        manifest += `导出日期: ${new Date().toLocaleString('zh-CN')}\n\n`
        manifest += `=== 材料清单 (${materials.length} 份) ===\n\n`
        sorted.forEach((m, i) => {
          manifest += `[${String(i + 1).padStart(2, '0')}] ${m.category || '其他'} - ${m.original_name}\n`
        })
        fs.writeFileSync(path.join(tmpDir, '案件清单.txt'), manifest, 'utf-8')

        // PowerShell 压缩
        const psScript = `Compress-Archive -Path "${tmpDir}\\*" -DestinationPath "${savePath}" -Force`
        execSync(`powershell -NoProfile -Command "${psScript}"`, { timeout: 30000 })

        createActivity(data.caseId, 'case_exported', `导出案件 ZIP (${materials.length} 份材料): ${savePath}`)
        return savePath
      } finally {
        // 清理临时目录
        try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
      }
    }

    // PDF 导出（用 jsPDF 本地生成，避免依赖 Python / 系统字体）
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `${c.case_number || '案件'}_${c.title}.pdf`,
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    })
    if (result.canceled) return null
    const savePath = result.filePath

    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')

    const { jsPDF } = require('jspdf') as typeof import('jspdf')
    const doc = new jsPDF()

    // 中文字体：优先使用用户系统字体，否则退回英文（不会抛错）
    // 注意：jsPDF 只能加载 TTF，.ttc（雅黑/宋体集合字体）无法解析，因此只用 TTF 候选
    const fontCandidates = [
      ['C:/Windows/Fonts/simhei.ttf', 'simhei', 'SimHei'],       // 黑体
      ['C:/Windows/Fonts/simkai.ttf', 'simkai', 'KaiTi'],        // 楷体
      ['C:/Windows/Fonts/Deng.ttf', 'dengxian', 'DengXian'],     // 等线
      ['C:/Windows/Fonts/Dengb.ttf', 'dengxian-bold', 'DengXianBold'],
      ['C:/Windows/Fonts/simsun.ttf', 'simsun', 'SimSun'],       // 宋体（Win10+ 为 TTF）
      ['C:/Windows/Fonts/msyh.ttf', 'msyh', 'MicrosoftYaHei'],   // 微软雅黑（Win10+ 为 TTF）
    ]
    let chineseFont: string | null = null
    for (const [fontPath, vfsName, fontFamily] of fontCandidates) {
      try {
        if (!fs.existsSync(fontPath)) continue
        doc.addFileToVFS(vfsName, fs.readFileSync(fontPath).toString('base64'))
        // 同一字体同时注册 normal / bold：只注册 normal 时，drawText 用 bold
        // 样式会静默回退到 Helvetica，中文变成乱码
        doc.addFont(vfsName, fontFamily, 'normal')
        doc.addFont(vfsName, fontFamily, 'bold')
        chineseFont = fontFamily
        break
      } catch { /* 该字体不可用，继续尝试下一个 */ }
    }
    const font = chineseFont || 'helvetica'

    // 封面
    doc.setFont(font, 'bold')
    doc.setFontSize(22)
    doc.text('电子卷宗', 105, 55, { align: 'center' })
    doc.setFont(font, 'normal')
    doc.setFontSize(12)
    const info = [
      ['案号', c.case_number || '-'],
      ['案由', c.title],
      ['管辖法院', c.court || '-'],
      ['委托人', c.client || '-'],
      ['立案日期', c.filing_date || '-'],
      ['材料数量', `${materials.length} 份`],
      ['生成日期', new Date().toLocaleString('zh-CN')],
    ]
    info.forEach(([label, value], i) => {
      doc.text(`${label}：${value}`, 30, 90 + i * 12)
    })

    // 目录（分页）
    doc.addPage()
    doc.setFont(font, 'bold')
    doc.setFontSize(14)
    doc.text('目　录', 105, 20, { align: 'center' })
    doc.setFont(font, 'normal')
    doc.setFontSize(11)
    let y = 35
    sorted.forEach((m, i) => {
      if (y > 285) {
        doc.addPage()
        y = 25
      }
      doc.text(`${i + 1}. [${m.category}] ${m.original_name}`, 20, y)
      y += 8
    })

    // 材料正文
    for (const m of sorted) {
      doc.addPage()
      doc.setFont(font, 'bold')
      doc.setFontSize(14)
      doc.text(m.original_name, 20, 20)
      doc.setFont(font, 'normal')
      doc.setFontSize(10)
      doc.text(`分类：${m.category}`, 20, 28)

      if (m.raw_text) {
        const lines = doc.splitTextToSize(m.raw_text, 170)
        // 手动分页：超出页面底部就换页（jsPDF 4.x 无 autoPage）
        let y = 40
        for (const line of lines) {
          if (y > 280) {
            doc.addPage()
            y = 20
          }
          doc.text(line, 20, y)
          y += 5
        }
      } else if (
        (m.mime_type === 'image/png' || m.mime_type === 'image/jpeg') &&
        fs.existsSync(m.stored_path)
      ) {
        // 图片材料：嵌入 PDF 页
        try {
          const base64 = fs.readFileSync(m.stored_path).toString('base64')
          const format = m.mime_type === 'image/png' ? 'PNG' : 'JPEG'
          const props = doc.getImageProperties(base64)
          const scale = Math.min(170 / props.width, 250 / props.height, 1)
          const w = props.width * scale
          const h = props.height * scale
          doc.addImage(base64, format, (210 - w) / 2, 35, w, h)
        } catch (imgErr) {
          doc.text(`（${m.original_name}：图片嵌入失败）`, 20, 40)
        }
      } else {
        doc.text(`（${m.original_name}：无文本内容）`, 20, 40)
      }
    }

    const buffer = Buffer.from(doc.output('arraybuffer'))
    // Windows 文件锁：目标文件正被其他程序（如 PDF 阅读器）打开时写入会报 EBUSY，
    // 自动改存为带编号的新文件名（1_a1 (1).pdf …）
    let finalPath = savePath
    let written = false
    for (let n = 0; n <= 10 && !written; n++) {
      try {
        fs.writeFileSync(finalPath, buffer)
        written = true
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EBUSY') throw err
        finalPath = path.join(
          path.dirname(savePath),
          `${path.basename(savePath, path.extname(savePath))} (${n + 1})${path.extname(savePath)}`,
        )
      }
    }
    if (!written) throw new Error('目标文件被占用（可能正在其他程序中打开），请关闭后重试')
    createActivity(data.caseId, 'case_exported', `导出案件为 PDF: ${finalPath}`)
    return finalPath
  })
}
