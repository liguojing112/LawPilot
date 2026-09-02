import { useState, useMemo, useCallback, Fragment } from 'react'
import { Drawer, Input, Typography, Spin, Empty } from 'antd'
import { SearchOutlined, QuestionCircleOutlined } from '@ant-design/icons'

const { Title, Paragraph, Text } = Typography

// 内嵌的用户手册内容（生产环境可从 HELP.md 文件读取）
const HELP_CONTENT = `
# LawPilot 用户手册

律航（LawPilot）是面向律师的本地智能工作平台：法规库、案件管理、非诉尽调报告、诉讼策略推演，内置 AI 对话与知识库问答。数据全部存储在本地，AI 能力通过你自己配置的大模型 API 提供。

## 功能概览

### 主要模块
- 仪表板：统计概览、最近上传材料、系统与知识库状态
- 法律法规：法规导入、全文搜索、条款浏览、版本对比
- 案件管理：案件台账、材料上传与自动分类、卷宗预览、PDF/ZIP 导出
- 非诉法律尽调：上传尽调材料，生成八大章节尽调报告
- 诉讼策略推演：输入案情，推演时间线、争议焦点、SWOT 与应对建议
- AI 对话：通用法律问答 + 知识库问答（RAG），回答附引用来源

### 能力说明
- 支持扫描件 OCR：PDF、图片（PNG/JPG/TIFF）均可提取文本
- AI 输出支持 Markdown 渲染（表格、标题、列表）
- 敏感信息可在发送 AI 前自动脱敏（设置中开关）

## 快速开始

### 配置 AI 大模型
1. 首次启动会弹出配置向导
2. 选择模型提供商（推荐 DeepSeek）
3. 输入 API Key 并点击"测试连接"
4. 通过后即可使用全部 AI 功能
5. 之后可随时在"设置"页修改配置

### 建议的第一步
1. 进入"法律法规"导入几部常用法规（TXT/MD/PDF/Word）
2. 在"案件管理"新建案件并上传卷宗材料
3. 按 Ctrl+J 打开 AI 对话，试试"知识库问答"

### 快捷键
- Ctrl+J ：打开/关闭 AI 对话面板
- Ctrl+K ：聚焦全文搜索（在法规页使用）
- Ctrl+N ：新建案件（不在案件页时自动跳转）

## 法律法规库

### 导入法规
1. 进入"法律法规"页，点击右上角"导入法规"
2. 支持格式：TXT、MD、PDF、DOC、DOCX
3. 系统自动解析法规名称、发文机关与条款结构（编→章→节→条）
4. 导入的法规会写入本地知识库，供 AI 知识库问答检索

### 全文搜索
- 在法规页搜索框或仪表板搜索框输入关键词
- 多关键词用空格分隔（如"合同 订立"）
- 结果高亮匹配词，点击直接跳转到对应条款

### 条款浏览
- 点击法规名称进入详情页
- 左侧条款树展示层级结构，点击条款查看完整内容
- 效力级别、发文机关、发布/施行日期等信息展示在详情页顶部

### 版本对比
- 在法规详情页的"版本管理"标签中
- 可添加修订版本并填写修订说明
- 选择两个版本逐行对比：新增内容绿色，删除内容红色

## 案件管理

### 新建案件
1. 进入"案件管理"页，点击"新建案件"（快捷键 Ctrl+N）
2. 填写案号、案由、案件类型、管辖法院、委托人、对方当事人等
3. 点击"创建"完成

### 上传案件材料
1. 在案件列表页或案件详情页，将文件拖入虚线框（或点击选择）
2. 支持格式：PDF、图片（PNG/JPG/TIFF）、Word（DOC/DOCX）、TXT、MD
3. 系统自动提取文本（扫描件走 OCR，多页 PDF 逐页处理）
4. AI 自动分类：起诉状、答辩状、证据、判决、裁定、合同等
5. 材料可关联案件，并填写证据编号、证明目的

### 卷宗预览与导出
- 案件详情页展示全部已关联材料
- 点击材料可预览全文（Markdown 格式的文档会渲染标题与表格）
- 自动识别材料中的实体（当事人、金额、日期等）
- 支持一键导出卷宗为 PDF 或 ZIP

## AI 对话与知识库问答

### 打开对话
- 按 Ctrl+J，或点击右上角 AI 图标
- 面板右上角可切换"知识库问答"模式

### 知识库问答（RAG）
- 自动检索本地法规与案件材料后作答，不依赖外部搜索
- 回答带 [来源N] 引用，底部展示对应的参考来源卡片
- 来源为法规时可点击"查看条款"，直接跳转到该条款
- 引用归属会自动校验，摘要对齐被引用的条款
- 知识库中没有相关内容时，AI 会如实说明，不编造

### 历史会话
- 面板顶部可切换/删除历史会话
- 会话与引用来源保存在本地，重启应用后仍可回看
- 消息支持复制与编辑重发

## 非诉法律尽调

### 生成尽调报告
1. 进入"非诉法律尽调"页
2. 填写项目信息：目标公司、委托方、尽调范围
3. 上传尽调材料（PDF/Word/图片，支持扫描件多页 OCR）
4. 可选填写人工发现的关键风险点（每行一条）
5. 点击"开始生成报告"

### 报告说明
- 生成约需 1~3 分钟，期间可切换到其他页面，完成后回来查看
- 报告含八大章节：引言、公司概况、业务资质、资产与产权、重大合同、诉讼与仲裁、风险评估、结论与建议
- 切换页面后材料文本自动恢复，无需重新上传
- 报告以 Markdown 渲染，支持一键导出 .md 文件
- 无文件材料时也可仅依据风险点生成报告
- 报告出具日期自动使用当天日期

## 诉讼策略推演

### 开始推演
1. 进入"诉讼策略推演"页
2. 输入详细案情（至少 20 字）：当事人、事件经过（含日期）、已有证据、对方主张
3. 点击"开始推演"

### 推演输出
- 案情时间线（按重要度着色）
- 当事人及其角色
- 争议焦点
- 匹配法条（自动检索本地知识库）
- SWOT 矩阵：有利点 / 不利点 / 机会 / 威胁
- 综合分析
- 应对策略建议（分条列出）

### 小贴士
- 推演约需 1~2 分钟，期间可切换页面，回来继续查看
- 案情描述自动保存，切页或重启应用都不会丢
- 案情写得越详细（日期、金额、证据形式），推演越准确

## 设置与本地知识库

### AI 大模型配置
- 在"设置"页修改 API Base URL、API Key、模型名称
- 修改后点击"测试连接"验证
- 可开关"AI 调用前显示脱敏确认"

### 隐私与脱敏
- 发送 AI 前可按级别自动替换敏感信息
- 开启脱敏确认后，每次调用前可查看替换详情

### 本地知识库
- 展示向量索引状态与已索引文档数
- "重建索引"会全量重新向量化法规与材料，耗时数分钟
- 批量导入新法规后建议重建一次

## 常见问题

### Python 服务未启动
- 现象：AI 功能提示"Python 服务未启动"
- 解决：先运行本地 Python 服务（开发模式 npm run python:dev），确认仪表板显示"Python 服务：已连接"后再使用 AI 功能

### OCR 识别失败
- 现象：上传扫描件后材料提示"未提取到文本"
- 解决：扫描件清晰度要足够；支持 PDF 与常见图片格式；混合文档（部分页有文字层）可正常处理

### API 配置错误
- 现象：AI 功能提示"连接失败"
- 解决：检查设置页的 API Key、Base URL、模型名称是否与提供商匹配，用"测试连接"验证

### 数据存在哪里
- 数据库：%APPDATA%\\lawpilot\\LawPilot\\lawpilot.db
- 材料文件：%APPDATA%\\lawpilot\\LawPilot\\files
- 向量索引：项目目录下 data/vectors
- 重置数据：关闭应用后删除数据库文件，再次启动自动新建

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
