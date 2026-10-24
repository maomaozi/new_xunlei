import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import DownloadsPage from './pages/DownloadsPage'
import DrivePage from './pages/DrivePage'
import EnginePage from './pages/EnginePage'
import EventsPage from './pages/EventsPage'
import OfflinePage from './pages/OfflinePage'
import OverviewPage from './pages/OverviewPage'
import SettingsPage from './pages/SettingsPage'
import SharesPage from './pages/SharesPage'
import TransfersPage from './pages/TransfersPage'
import TrashPage from './pages/TrashPage'
import { EmptyState, PillButton } from './components/ui'
import { Compass } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

function NotFound() {
  const navigate = useNavigate()
  return <EmptyState icon={Compass} title="页面不存在" action={<PillButton onClick={() => navigate('/')}>返回首页</PillButton>} />
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="drive" element={<DrivePage />} />
        <Route path="drive/:folderId" element={<DrivePage />} />
        <Route path="offline" element={<OfflinePage />} />
        <Route path="downloads" element={<DownloadsPage />} />
        <Route path="engine" element={<EnginePage />} />
        <Route path="device" element={<Navigate to="/downloads" replace />} />
        <Route path="transfers" element={<TransfersPage />} />
        <Route path="shares" element={<SharesPage />} />
        <Route path="trash" element={<TrashPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/:tab" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
