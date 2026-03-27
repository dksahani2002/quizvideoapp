import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { AuthProvider } from './hooks/useAuth';
import { AuthGuard } from './components/layout/AuthGuard';
import { Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { CreateVideo } from './pages/CreateVideo';
import { VideoLibrary } from './pages/VideoLibrary';
import { SettingsPage } from './pages/Settings';
import { Login } from './pages/Login';
import { Register } from './pages/Register';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10000 } },
});

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <AuthGuard>
      <div className="min-h-screen">
        {/* Mobile header */}
        <header className="md:hidden sticky top-0 z-50 bg-[hsl(var(--background))] border-b border-[hsl(var(--border))]">
          <div className="h-14 px-4 flex items-center justify-between">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 -ml-2 rounded-lg hover:bg-[hsl(var(--secondary))] transition-colors"
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <div className="text-sm font-semibold">MCQ Shorts</div>
            <div className="w-8" />
          </div>
        </header>

        {/* Desktop layout */}
        <div className="hidden md:flex min-h-screen">
          <div className="fixed left-0 top-0 h-screen z-40">
            <Sidebar />
          </div>
          <main className="flex-1 ml-60 p-8">{children}</main>
        </div>

        {/* Mobile layout */}
        <main className="md:hidden p-4 pb-10">{children}</main>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="md:hidden fixed inset-0 z-60">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setMobileOpen(false)}
            />
            <div className="absolute left-0 top-0 h-full w-72 max-w-[85vw] bg-[hsl(var(--card))] border-r border-[hsl(var(--border))]">
              <div className="h-14 px-3 flex items-center justify-between border-b border-[hsl(var(--border))]">
                <div className="text-sm font-semibold text-[hsl(var(--primary))]">MCQ Shorts</div>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="p-2 rounded-lg hover:bg-[hsl(var(--secondary))] transition-colors"
                  aria-label="Close navigation"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="h-[calc(100%-3.5rem)] overflow-y-auto" onClick={() => setMobileOpen(false)}>
                <Sidebar />
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/" element={<ProtectedLayout><Dashboard /></ProtectedLayout>} />
            <Route path="/create" element={<ProtectedLayout><CreateVideo /></ProtectedLayout>} />
            <Route path="/videos" element={<ProtectedLayout><VideoLibrary /></ProtectedLayout>} />
            <Route path="/settings" element={<ProtectedLayout><SettingsPage /></ProtectedLayout>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
