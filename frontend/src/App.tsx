import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { lazy, Suspense } from 'react'
import { AdminPage } from './pages/AdminPage'
import { ApprovalsPage } from './pages/ApprovalsPage'
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
        <Route path="godkjenning" element={<ApprovalsPage />} />
        <Route path="medlemmer" element={<Suspense fallback={null}><OrgMembersPage /></Suspense>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
