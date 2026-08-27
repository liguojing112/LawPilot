import { useMemo, useEffect, useRef } from 'react'
import { Tree } from 'antd'
import type { TreeDataNode } from 'antd'
import type { LawArticle } from '../../../shared/types'

interface Props {
  articles: LawArticle[]
  selectedId: string | null
  highlightId?: string
  onSelect: (article: LawArticle) => void
}

/** 将平铺 articles 按 parent_id 构建树 */
function buildTree(articles: LawArticle[]): LawArticle[] {
  const map = new Map<string, LawArticle>()
  const roots: LawArticle[] = []

  for (const a of articles) {
    map.set(a.id, { ...a, children: [] })
  }

  for (const a of articles) {
    const node = map.get(a.id)!
    if (a.parent_id && map.has(a.parent_id)) {
      const parent = map.get(a.parent_id)!
      parent.children = parent.children || []
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

/** 递归将 LawArticle[] 转为 Ant Design TreeDataNode[] */
function toTreeData(articles: LawArticle[]): TreeDataNode[] {
  return articles.map((a) => ({
    key: a.id,
    title: a.article_num
      ? `${a.article_num} ${a.title || ''}`
      : a.title || a.content.slice(0, 40),
    children: a.children && a.children.length > 0 ? toTreeData(a.children) : undefined,
    isLeaf: !a.children || a.children.length === 0,
    _raw: a,
  }))
}

/** 递归收集所有节点 key（用于展开所有） */
function collectAllKeys(articles: LawArticle[]): string[] {
  const keys: string[] = []
  for (const a of articles) {
    keys.push(a.id)
    if (a.children && a.children.length > 0) {
      keys.push(...collectAllKeys(a.children))
    }
  }
  return keys
}

export function LawTree({ articles, selectedId, highlightId, onSelect }: Props) {
  const treeData = useMemo(() => {
    const tree = buildTree(articles)
    return toTreeData(tree)
  }, [articles])

  // 默认展开全部
  const defaultExpandedKeys = useMemo(() => collectAllKeys(buildTree(articles)), [articles])

  // 当 highlightId 变化时，滚动到对应节点
  const treeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (highlightId) {
      setTimeout(() => {
        const el = document.querySelector(`[data-tree-key="${highlightId}"]`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          ;(el as HTMLElement).classList.add('bg-yellow-100')
          setTimeout(() => {
            ;(el as HTMLElement).classList.remove('bg-yellow-100')
          }, 3000)
        }
      }, 300)
    }
  }, [highlightId])

  function handleSelect(keys: React.Key[]) {
    if (keys.length === 0) return
    const key = keys[0] as string
    // 从 treeData 查找原始 article
    function findArticle(nodes: TreeDataNode[]): LawArticle | null {
      for (const n of nodes) {
        if (n.key === key) return (n as any)._raw as LawArticle
        if (n.children) {
          const found = findArticle(n.children)
          if (found) return found
        }
      }
      return null
    }
    const article = findArticle(treeData)
    if (article) onSelect(article)
  }

  return (
    <div ref={treeRef}>
      <Tree
        treeData={treeData}
        defaultExpandedKeys={defaultExpandedKeys}
        selectedKeys={selectedId ? [selectedId] : []}
        onSelect={handleSelect}
        blockNode
        showLine={{ showLeafIcon: false }}
        titleRender={(node) => (
          <span
            data-tree-key={node.key}
            className={`text-sm transition-colors duration-500 ${node.key === highlightId ? 'bg-yellow-100' : ''}`}
          >
            {node.title as string}
          </span>
        )}
      />
    </div>
  )
}
