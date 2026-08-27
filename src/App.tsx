import { ConfigProvider, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { HashRouter } from 'react-router-dom'
import { antdTheme } from './styles/antd-theme'
import { AppRoutes } from './routes'
import { ErrorBoundary } from './components/ErrorBoundary'
import { WelcomeWizard } from './components/WelcomeWizard'

export function App() {
  return (
    <ConfigProvider theme={antdTheme} locale={zhCN}>
      <AntApp>
        <ErrorBoundary>
          <HashRouter>
            <AppRoutes />
          </HashRouter>
          <WelcomeWizard />
        </ErrorBoundary>
      </AntApp>
    </ConfigProvider>
  )
}
