import { useState, useRef, useCallback } from 'react'
import { AutoComplete, Input } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { SearchResult } from '../../shared/types'

export function SearchBar() {
  const [options, setOptions] = useState<{ value: string; label: React.ReactNode; item: SearchResult }[]>([])
  const [searching, setSearching] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigate = useNavigate()

  const handleSearch = useCallback((value: string) => {
    if (!value || value.trim().length < 2) {
      setOptions([])
      return
    }

    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await window.api.law.search(value.trim(), 10)
        setOptions(
          results.map((r) => ({
            value: `${r.law_title} — ${r.article_num || ''}`,
            label: (
              <div className="py-1">
                <div className="text-sm font-medium">{r.law_title}</div>
                <div className="text-xs text-gray-500">
                  {r.article_num ? `${r.article_num}: ` : ''}
                  <span dangerouslySetInnerHTML={{ __html: r.snippet }} />
                </div>
              </div>
            ),
            item: r,
          }))
        )
      } catch {
        setOptions([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [])

  function handleSelect(_value: string, option: { item: SearchResult }): void {
    navigate(`/laws/${option.item.law_id}?article=${option.item.id}`)
  }

  return (
    <AutoComplete
      className="w-full"
      options={options}
      onSearch={handleSearch}
      onSelect={handleSelect}
      notFoundContent={searching ? '搜索中...' : '输入至少2个字开始搜索'}
    >
      <Input
        prefix={<SearchOutlined className="text-gray-400" />}
        placeholder="全文搜索法规条款... (Ctrl+K)"
        size="middle"
        allowClear
      />
    </AutoComplete>
  )
}
