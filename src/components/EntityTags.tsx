import { Tag, Tooltip, Space } from 'antd'
import {
  UserOutlined,
  BankOutlined,
  CalendarOutlined,
  DollarOutlined,
  FileTextOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import type { ExtractedEntities } from '../utils/entityExtractor'
import { hasEntities } from '../utils/entityExtractor'

interface Props {
  entities: ExtractedEntities
  /** AI 提取的结果（可选），优先级高于正则 */
  aiEntities?: ExtractedEntities
  /** 已有案件列表（用于案号匹配建议） */
  cases?: Array<{ id: string; case_number?: string; title: string }>
  /** 点击案号时的回调 */
  onCaseNumberClick?: (caseId: string) => void
}

export function EntityTags({ entities, aiEntities, cases = [], onCaseNumberClick }: Props) {
  // AI 结果优先，否则用正则结果
  const display = aiEntities || entities
  const isAI = !!aiEntities

  if (!hasEntities(display)) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1 items-center">
      {isAI && (
        <Tooltip title="AI 提取结果">
          <RobotOutlined className="text-xs text-blue-400 mr-1" />
        </Tooltip>
      )}
      {display.persons.slice(0, 5).map((p, i) => (
        <Tooltip title="当事人" key={`p-${i}`}>
          <Tag icon={<UserOutlined />} color="blue" className="text-xs">
            {p}
          </Tag>
        </Tooltip>
      ))}
      {display.persons.length > 5 && (
        <Tag color="blue" className="text-xs">+{display.persons.length - 5}</Tag>
      )}

      {display.orgs.slice(0, 3).map((o, i) => (
        <Tooltip title="机构" key={`o-${i}`}>
          <Tag icon={<BankOutlined />} color="purple" className="text-xs">
            {o}
          </Tag>
        </Tooltip>
      ))}
      {display.orgs.length > 3 && (
        <Tag color="purple" className="text-xs">+{display.orgs.length - 3}</Tag>
      )}

      {display.dates.slice(0, 3).map((d, i) => (
        <Tooltip title="日期" key={`d-${i}`}>
          <Tag icon={<CalendarOutlined />} color="cyan" className="text-xs">
            {d}
          </Tag>
        </Tooltip>
      ))}

      {display.amounts.slice(0, 3).map((a, i) => (
        <Tooltip title="金额" key={`a-${i}`}>
          <Tag icon={<DollarOutlined />} color="orange" className="text-xs">
            {a}
          </Tag>
        </Tooltip>
      ))}

      {display.caseNumbers.map((cn, i) => {
        // 查找匹配的案件
        const matchedCase = cases.find((c) => c.case_number && cn.includes(c.case_number))
        if (matchedCase && onCaseNumberClick) {
          return (
            <Tooltip title={`关联案件: ${matchedCase.title}`} key={`cn-${i}`}>
              <Tag
                icon={<FileTextOutlined />}
                color="green"
                className="text-xs cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onCaseNumberClick(matchedCase.id) }}
              >
                {cn}
              </Tag>
            </Tooltip>
          )
        }
        return (
          <Tooltip title="案号" key={`cn-${i}`}>
            <Tag icon={<FileTextOutlined />} color="green" className="text-xs">
              {cn}
            </Tag>
          </Tooltip>
        )
      })}
    </div>
  )
}
