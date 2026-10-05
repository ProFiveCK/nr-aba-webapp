import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/useAuth';
import { ToastProvider } from './contexts/ToastContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { Login } from './pages/Login';
import { Layout } from './components/Layout';
import { ResetPasswordModal } from './components/ResetPasswordModal';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { Dashboard } from './pages/Dashboard';
// Every app is loaded on demand. Now that each one owns a route, somebody who
// only ever opens Leave no longer downloads ABA, Banking and the rest to get
// there — which they did when these were imported up front.
const AbaWorkflow = lazy(() => import('./pages/AbaWorkflow').then((m) => ({ default: m.AbaWorkflow })));
const Tools = lazy(() => import('./pages/Tools').then((m) => ({ default: m.Tools })));
const ForexTTApp = lazy(() => import('./pages/ForexTTApp').then((m) => ({ default: m.ForexTTApp })));
const PublicHealthApp = lazy(() => import('./pages/PublicHealthApp').then((m) => ({ default: m.PublicHealthApp })));
const Banking = lazy(() => import('./pages/Banking').then((m) => ({ default: m.Banking })));
const Payroll = lazy(() => import('./pages/Payroll').then((m) => ({ default: m.Payroll })));
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })));
const LeaveApp = lazy(() => import('./apps/leave/LeaveApp').then((m) => ({ default: m.LeaveApp })));

declare global {
  interface Window {
    handleAuthExpired?: () => void;
  }
}

const SPINNER = (
  <div className="flex h-full min-h-96 items-center justify-center">
    <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-amber-500"></div>
  </div>
);

function AuthedRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Every app owns its page from the top: the portal draws the header
            bar and the app's section menu, and the app's own content starts
            immediately below. No app prints a portal-supplied title. */}
        <Route index element={<Dashboard />} />
        <Route path="aba/*" element={<AbaWorkflow />} />
        <Route path="banking/*" element={<Banking />} />
        <Route path="payroll/*" element={<Payroll />} />
        <Route path="tools/*" element={<Tools />} />
        <Route path="forex-tt/*" element={<ForexTTApp />} />
        <Route path="fit-for-duty/*" element={<PublicHealthApp />} />
        <Route path="leave/*" element={<LeaveApp />} />
        <Route path="admin/*" element={<Admin />} />

        {/* Earlier names, kept so saved links and emails still land. */}
        <Route path="hr/*" element={<Navigate to="/leave" replace />} />
        <Route path="wellness/*" element={<Navigate to="/fit-for-duty" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading, logout, requiresPasswordChange } = useAuth();
  const [resetToken, setResetToken] = useState<string | null>(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#reset-password=')) {
      const token = hash.substring('#reset-password='.length);
      if (token) {
        window.location.hash = '';
        return token;
      }
    }
    return null;
  });

  useEffect(() => {
    window.handleAuthExpired = () => {
      logout();
      console.log('Session expired. Please log in again.');
    };

    return () => {
      delete window.handleAuthExpired;
    };
  }, [logout]);

  const handleResetPasswordClose = () => setResetToken(null);

  const handleResetPasswordSuccess = () => {
    setResetToken(null);
    // Force a logout if they're logged in, so they can login with new password
    if (isAuthenticated) logout();
  };

  const resetModal = resetToken && (
    <ResetPasswordModal
      token={resetToken}
      onClose={handleResetPasswordClose}
      onSuccess={handleResetPasswordSuccess}
    />
  );

  if (isLoading) {
    return (
      <>
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500"></div>
            <p className="mt-4 text-gray-600">Loading...</p>
          </div>
        </div>
        {resetModal}
      </>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <Login />
        {resetModal}
      </>
    );
  }

  return (
    <>
      <Suspense fallback={SPINNER}>
        <AuthedRoutes />
      </Suspense>
      {resetModal}
      {requiresPasswordChange && (
        <ChangePasswordModal
          onClose={() => {
            // Forced password change cannot be dismissed; logout instead.
            logout();
          }}
        />
      )}
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AppContent />
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
