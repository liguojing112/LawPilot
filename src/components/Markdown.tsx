import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  children: string
  className?: string
}

/**
 * 通用 Markdown 渲染（GFM：表格/删除线等）。
 * 样式见 global.css 的 .markdown-body。
 * 流式输出期间请勿使用（增量重解析开销大），展示纯文本即可。
 */
export function Markdown({ children, className }: Props) {
  if (!children) return null
  return (
    <div className={`markdown-body ${className || ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}
