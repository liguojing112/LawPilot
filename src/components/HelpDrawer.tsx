import { useState, useMemo, useCallback, Fragment } from 'react'
import { Drawer, Input, Typography, Spin, Empty } from 'antd'
import { SearchOutlined, QuestionCircleOutlined } from '@ant-design/icons'

const { Title, Paragraph, Text } = Typography

// 内嵌的用户手册内容（生产环境可从 HELP.md 文件读取）
const HELP_CONTENT = `
# LawPilot 用户手册

## 快速开始

### 安装与启动
1. 双击 \`LawPilot-Setup-1.0.0.exe\` 安装包
2. 按照安装向导完成安装
3. 桌面双击 LawPilot 图标启动应用

### 配置 AI 大模型
1. 首次启动会弹出配置向导
2. 选择模型提供商（推荐 DeepSeek）
3. 输入 API Key 并点击"测试连接"
4. 完成后即可使用全部 AI 功能

### 界面概览
左侧导航栏：切换各个功能模块
右侧内容区：当前模块的工作区域
仪表板：概览统计数据与系统状态

### AI 对话面板
使用 \`Ctrl+J\` 快速打开 AI 对话
支持流式实时回复
可在对话中启用 RAG 模式自动检索本地知识库

---

## 法律法规库

### 导入法规文件
1. 点击左侧导航进入"法律法规"页面
2. 点击右上角"导入法规"按钮
3. 选择 \`.txt\` 或 \`.md\` 格式的法规文件
4. 系统自动解析法规标题、发文机关、条款结构

### 全文搜索
在法规列表页或仪表板搜索框中输入关键词
支持多关键词空格分隔（如"合同 订立"）
结果高亮显示匹配关键词
点击结果可直接跳转到对应条款

### 条款浏览
点击法规名称进入详情页
左侧条款树展示层级结构（编→章→节→条）
点击条款查看完整内容

### 版本对比
在法规详情页的"版本管理"标签中
可添加法规的修订版本
选择两个版本进行逐行差异对比
新增行绿色标识，删除行红色标识

---

## 案件管理

### 新建案件
1. 进入"案件管理"页面
2. 点击"新建案件"按钮（或使用快捷键 \`Ctrl+N\`）
3. 填写案号、案由、案件类型、管辖法院等信息
4. 点击"创建"完成

### 上传案件材料
1. 在案件管理页或案件详情页
2. 将文件拖入虚线框区域（或点击选择）
3. 支持格式：PDF、图片（PNG/JPG/TIFF）、Word（DOC/DOCX）、TXT
4. 系统自动进行 OCR 文本提取和材料分类
5. 处理完成后显示分类标签

### 材料自动分类
系统会根据文件内容自动识别材料类型
标签包括：起诉状、答辩状、证据、判决、裁定、合同等
可在案件详情页查看和管理已关联材料

### 卷宗预览与导出
在案件详情页可预览所有材料
材料按法院归档规范自动排序
选择材料可直接查看文本内容
支持导出为 ZIP 或 PDF 格式

---

## AI 法律分析

### 非诉尽调报告
1. 进入"尽调报告"页面
2. 填写项目信息（目标公司、委托方、尽调范围）
3. 上传尽调资料文件
4. 输入关键风险点（可选）
5. 点击"开始生成报告"
6. AI 自动生成包含八大章节的法律尽职调查报告
7. 报告可在线编辑并导出 Markdown

### 诉讼策略推演
1. 进入"诉讼策略"页面
2. 输入详细案情描述（至少 20 字）
3. 点击"开始推演"
4. AI 自动分析输出：
   案情时间线
   当事人关系
   争议焦点
   匹配法条
   SWOT 矩阵（有利点/不利点/机会/威胁）
   应对策略建议

---

## 常见问题

### Python 服务未启动
**现象**：Dashboard 显示"Python 服务：未连接"
**原因**：Python 后端服务未启动
**解决**：确保已安装 Python 3.10+，在项目目录运行 \`pip install -e python/\`，再运行 \`npm run python:dev\` 启动服务

### OCR 识别失败
**现象**：上传扫描件后 OCR 状态为"错误"
**解决**：确保 PaddleOCR 已正确安装，文件格式为图片（PNG/JPG）或 PDF，扫描件清晰度足够高

### API 配置错误
**现象**：AI 功能提示"连接失败"或"未配置 API"
**解决**：检查设置页面的 API Key 是否正确，确认 Base URL 和模型名称与提供商匹配，使用"测试连接"按钮验证配置

### 数据库损坏修复
**现象**：应用无法启动或数据显示异常
**解决**：备份数据库文件（位于 \`%APPDATA%/LawPilot/lawpilot.db\`），删除后重启应用自动创建新库，重新导入法规和案件数据

---

## 快捷键

| 快捷键 | 功能 |
|---|---|
| \`Ctrl+K\` | 全文搜索法规条款 |
| \`Ctrl+N\` | 新建案件 |
| \`Ctrl+J\` | 打开 AI 对话面板 |
`

// 生成用于锚点跳转的 id
function sectionId(name: string): string {
  return 'help-' + name.replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fff-]/g, '')
}

// 渲染行内 Markdown：**加粗**、`代码`、*斜体*
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*(.+?)\*\*)|(`(.+?)`)|(\*(.+?)\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // 前面的纯文本
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[1]) {
      // **加粗**
      parts.push(<strong key={match.index}>{match[2]}</strong>)
    } else if (match[3]) {
      // `代码`
      parts.push(<code key={match.index} style={{ backgroundColor: '#f5f5f5', padding: '1px 4px', borderRadius: 3, fontSize: '0.9em' }}>{match[4]}</code>)
    } else if (match[5]) {
      // *斜体*
      parts.push(<em key={match.index}>{match[6]}</em>)
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

interface Props {
  open: boolean
  onClose: () => void
}

export function HelpDrawer({ open, onClose }: Props) {
  const [searchTerm, setSearchTerm] = useState('')

  // 根据搜索词过滤
  const filteredContent = useMemo(() => {
    if (!searchTerm.trim()) return HELP_CONTENT

    const lines = HELP_CONTENT.split('\n')
    const result: string[] = []
    let inSection = false

    for (const line of lines) {
      if (line.startsWith('## ') || line.startsWith('# ')) {
        inSection = false
        result.push(line)
        continue
      }
      if (line.startsWith('### ')) {
        inSection = true
        result.push(line)
        continue
      }
      if (inSection) {
        result.push(line)
      }
    }

    const joined = result.join('\n')
    if (!joined.toLowerCase().includes(searchTerm.toLowerCase())) {
      return HELP_CONTENT
    }
    return joined
  }, [searchTerm])

  // 提取 ## 标题作为目录
  const sections = useMemo(() => {
    const secs: string[] = []
    for (const line of filteredContent.split('\n')) {
      if (line.startsWith('## ') && !line.startsWith('### ')) {
        secs.push(line.replace('## ', ''))
      }
    }
    return secs
  }, [filteredContent])

  // 点击目录项滚动到对应位置
  const scrollToSection = useCallback((name: string) => {
    const el = document.getElementById(sectionId(name))
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  return (
    <Drawer
      title="帮助"
      open={open}
      onClose={onClose}
      width={520}
      extra={
        <QuestionCircleOutlined style={{ fontSize: 18, color: '#1677ff' }} />
      }
    >
      <Input
        prefix={<SearchOutlined />}
        placeholder="搜索帮助内容..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        allowClear
        style={{ marginBottom: 16 }}
      />

      {/* 目录 */}
      {!searchTerm && sections.length > 0 && (
        <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#f9fafb', borderRadius: 8 }}>
          <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#6b7280' }}>目录</Text>
          {sections.map((s) => (
            <a
              key={s}
              onClick={() => scrollToSection(s)}
              style={{
                display: 'block',
                fontSize: 13,
                color: '#1677ff',
                cursor: 'pointer',
                marginBottom: 4,
                padding: '2px 4px',
                borderRadius: 4,
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.backgroundColor = '#e6f4ff' }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.backgroundColor = 'transparent' }}
            >
              {s}
            </a>
          ))}
        </div>
      )}

      {/* 渲染 */}
      <div style={{ maxWidth: 'none', fontSize: 14, lineHeight: 1.8 }}>
        {filteredContent.split('\n').map((line, i) => {
          // 一级标题 #
          if (line.startsWith('# ')) {
            return (
              <Title key={i} level={3} style={{ marginTop: 0, marginBottom: 16 }}>
                {line.replace('# ', '')}
              </Title>
            )
          }
          // 二级标题 ##
          if (line.startsWith('## ') && !line.startsWith('### ')) {
            const name = line.replace('## ', '')
            return (
              <Title key={i} level={4} id={sectionId(name)} style={{ marginTop: 24, marginBottom: 8 }}>
                {name}
              </Title>
            )
          }
          // 三级标题 ###
          if (line.startsWith('### ')) {
            return (
              <Title key={i} level={5} style={{ marginTop: 16, marginBottom: 4 }}>
                {line.replace('### ', '')}
              </Title>
            )
          }
          // 表格行
          if (line.startsWith('| ') && line.includes('|')) {
            return (
              <Paragraph key={i} style={{ marginBottom: 0, fontFamily: 'monospace', fontSize: 12 }}>
                {renderInline(line)}
              </Paragraph>
            )
          }
          // 有序列表 1. 2. 3. 4.
          if (line.match(/^\d+\. /)) {
            return (
              <Paragraph key={i} style={{ marginBottom: 2, paddingLeft: 16 }}>
                {renderInline(line)}
              </Paragraph>
            )
          }
          // 无序列表 - 或子列表（以空格缩进开头）
          if (line.startsWith('- ')) {
            const content = line.replace(/^- /, '')
            return (
              <Paragraph key={i} style={{ marginBottom: 2, paddingLeft: 16 }}>
                <span style={{ marginRight: 8, color: '#bbb' }}>•</span>
                {renderInline(content)}
              </Paragraph>
            )
          }
          // 空白行
          if (line.trim() === '') {
            return <div key={i} style={{ height: 8 }} />
          }
          // 分割线
          if (line.trim() === '---') {
            return <hr key={i} style={{ margin: '12px 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />
          }
          // 普通段落
          return (
            <Paragraph key={i} style={{ marginBottom: 2 }}>
              {renderInline(line)}
            </Paragraph>
          )
        })}
      </div>
    </Drawer>
  )
}
