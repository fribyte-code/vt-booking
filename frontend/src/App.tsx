import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { lazy, Suspense } from 'react'
import { IS_DEMO } from './config'
import { AdminPage } from './pages/AdminPage'
import { CalendarPage } from './pages/CalendarPage'
import { MyBookingsPage } from './pages/MyBookingsPage'

const OrgMembersPage = lazy(() => import('./pages/OrgMembersPage').then((m) => ({ default: m.OrgMembersPage })))

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<CalendarPage />} />
        <Route path="mine-bookinger" element={<MyBookingsPage />} />
        <Route path="admin" element={<AdminPage />} />
        {!IS_DEMO && <Route path="medlemmer" element={<Suspense fallback={null}><OrgMembersPage /></Suspense>} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
