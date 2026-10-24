import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import SettingsProvider from './components/SettingsProvider.tsx'
import ThemedApp from './components/ThemedApp.tsx'
import { isAuthError } from './lib/api'
import { setupPhoneViewport } from './lib/viewport'

setupPhoneViewport()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !isAuthError(error) && count < 1,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <ThemedApp>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ThemedApp>
      </SettingsProvider>
    </QueryClientProvider>
  </StrictMode>,
)
