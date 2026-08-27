import { useState, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Typography, message, Button, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import type { ReactNode } from 'react'
type MenuItem = NonNullable<MenuProps['items']>[number]
import {
  HomeOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  AuditOutlined,
  BulbOutlined,
  SettingOutlined,
  QuestionCircleOutlined,
  GlobalOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import { HelpDrawer } from '../components/HelpDrawer'
import { AiPanel } from '../components/AiPanel'

const { Header, Content } = Layout
const { Text } = Typography

// 中英文菜单映射
const MENU_I18N: Record<string, { zh: string; en: string }> = {
  '/': { zh: '首页', en: 'Home' },
  '/laws': { zh: '法律法规', en: 'Laws' },
  '/cases': { zh: '案件管理', en: 'Cases' },
  '/due-diligence': { zh: '尽调报告', en: 'Due Diligence' },
  '/strategy': { zh: '诉讼策略', en: 'Strategy' },
  '/settings': { zh: '设置', en: 'Settings' },
  help: { zh: '帮助', en: 'Help' },
}

type Lang = 'zh' | 'en'

const menuItems: { key: string; icon: ReactNode }[] = [
  { key: '/', icon: <HomeOutlined /> },
  { key: '/laws', icon: <FileTextOutlined /> },
  { key: '/cases', icon: <FolderOpenOutlined /> },
  { key: '/due-diligence', icon: <AuditOutlined /> },
  { key: '/strategy', icon: <BulbOutlined /> },
  { key: '/settings', icon: <SettingOutlined /> },
]

export function MainLayout() {
  const [helpOpen, setHelpOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [lang, setLang] = useState<Lang>('zh')
  const navigate = useNavigate()
  const location = useLocation()

  const t = (key: string) => MENU_I18N[key]?.[lang] || key

  // 为菜单项注入当前语言标签
  const localizedMenuItems: MenuItem[] = menuItems.map((item) => ({
    ...item,
    label: t(item.key),
  }))

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    navigate(key)
  }

  function toggleLang() {
    setLang((prev) => (prev === 'zh' ? 'en' : 'zh'))
  }

  // 全局快捷键
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        const searchInput = document.querySelector<HTMLInputElement>(
          '.ant-select-selection-search-input, input[placeholder*="搜索"], input[placeholder*="Search"]'
        )
        if (searchInput) {
          searchInput.focus()
        } else {
          message.info(lang === 'zh' ? '请进入法律法规页面使用全文搜索' : 'Please go to Laws page to search')
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        if (location.pathname.startsWith('/cases')) {
          const btn = document.querySelector<HTMLButtonElement>('button.ant-btn-primary')
          if (btn) btn.click()
        } else {
          navigate('/cases')
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        e.preventDefault()
        setAiOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [location.pathname, navigate, lang])

  const currentMenuKey = (() => {
    if (location.pathname === '/') return '/'
    if (location.pathname.startsWith('/laws')) return '/laws'
    if (location.pathname.startsWith('/cases')) return '/cases'
    if (location.pathname.startsWith('/due-diligence')) return '/due-diligence'
    if (location.pathname.startsWith('/strategy')) return '/strategy'
    if (location.pathname.startsWith('/settings')) return '/settings'
    return '/'
  })()

  return (
    <Layout className="h-screen">
      <Header
        className="flex items-center px-4 border-b border-gray-200"
        style={{ background: '#fff', height: 48, lineHeight: '48px' }}
      >
        {/* Logo */}
        <div
          className="flex-shrink-0 mr-6 cursor-pointer select-none"
          onClick={() => navigate('/')}
          style={{ display: 'flex', alignItems: 'center' }}
        >
          <Text strong style={{ color: '#1677ff', fontSize: 16, letterSpacing: 1 }}>
            {lang === 'zh' ? '律航' : 'LawPilot'}
          </Text>
        </div>

        {/* 导航菜单 */}
        <Menu
          mode="horizontal"
          selectedKeys={[currentMenuKey]}
          items={localizedMenuItems}
          onClick={handleMenuClick}
          className="flex-1 border-0"
          style={{ lineHeight: '46px' }}
        />

        {/* 右侧工具按钮 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <Tooltip title={lang === 'zh' ? 'AI 对话 (Ctrl+J)' : 'AI Chat (Ctrl+J)'}>
            <Button
              type="text"
              size="small"
              icon={<RobotOutlined />}
              onClick={() => setAiOpen(true)}
              className={aiOpen ? 'text-blue-500' : 'text-gray-500 hover:text-blue-500'}
            />
          </Tooltip>

          <Tooltip title={lang === 'zh' ? 'Switch to English' : '切换到中文'}>
            <Button
              type="text"
              size="small"
              icon={<GlobalOutlined />}
              onClick={toggleLang}
              className="text-gray-500 hover:text-blue-500"
            />
          </Tooltip>

          <Tooltip title={t('help')}>
            <Button
              type="text"
              size="small"
              icon={<QuestionCircleOutlined />}
              onClick={() => setHelpOpen(true)}
              className="text-gray-500 hover:text-blue-500"
            />
          </Tooltip>
        </div>
      </Header>

      <Layout>
        <Content className="m-4 p-6 bg-white rounded-lg overflow-auto">
          <Outlet />
        </Content>
      </Layout>

      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
      <AiPanel open={aiOpen} onClose={() => setAiOpen(false)} />
    </Layout>
  )
}
