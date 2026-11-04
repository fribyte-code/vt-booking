import '@fontsource-variable/inter'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import App from './App.tsx'
import { AppProvider } from './context/AppProvider.tsx'
import { PublicRequestPage } from './pages/PublicRequestPage.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* The public request form works without logging in, so it sits outside AppProvider. */}
        <Route path="/soknad" element={<PublicRequestPage />} />
        <Route
          path="*"
          element={
            <AppProvider>
              <App />
            </AppProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
