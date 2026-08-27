import { Routes, Route, Navigate } from 'react-router-dom'
import { MainLayout } from './layouts/MainLayout'
import { Dashboard } from './pages/Dashboard'
import { LawList } from './pages/Laws/LawList'
import { LawDetailPage } from './pages/Laws/LawDetail'
import { CaseList } from './pages/Cases/CaseList'
import { CaseDetail } from './pages/Cases/CaseDetail'
import { SettingsPage } from './pages/Settings/SettingsPage'
import { DdWorkspace } from './pages/DueDiligence/DdWorkspace'
import { StrategyWorkspace } from './pages/Strategy/StrategyWorkspace'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/laws" element={<LawList />} />
        <Route path="/laws/:id" element={<LawDetailPage />} />
        <Route path="/cases" element={<CaseList />} />
        <Route path="/cases/:id" element={<CaseDetail />} />
        <Route path="/due-diligence" element={<DdWorkspace />} />
        <Route path="/strategy" element={<StrategyWorkspace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
