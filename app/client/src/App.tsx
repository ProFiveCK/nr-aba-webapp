import { lazy, Suspense, useEffect, useState } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/useAuth';
import { ToastProvider } from './contexts/ToastContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { Login } from './pages/Login';
import { Layout } from './components/Layout';
import { ResetPasswordModal } from './components/ResetPasswordModal';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { Dashboard } from './pages/Dashboard';
import { AbaWorkflow } from './pages/AbaWorkflow';
import { Tools } from './pages/Tools';
import { ForexTTApp } from './pages/ForexTTApp';
import { PublicHealthApp } from './pages/PublicHealthApp';
import { findApp, type AppId } from './lib/apps';
import { readHash, setHash } from './lib/hash';

const Banking = lazy(() => import('./pages/Banking').then((module) => ({ default: module.Banking })));
const Payroll = lazy(() => import('./pages/Payroll').then((module) => ({ default: module.Payroll })));
const Admin = lazy(() => import('./pages/Admin').then((module) => ({ default: module.Admin })));
const HrApp = lazy(() => import('./pages/HrApp').then((module) => ({ default: module.HrApp })));

function appIdFromHash(): AppId | null {
  const { app } = readHash();
  if (!app || app.startsWith('reset-password=')) return null;
  return findApp(app as AppId) ? (app as AppId) : null;
}

declare global {
  interface Window {
    handleAuthExpired?: () => void;
  }
}

function AppContent() {
  const { isAuthenticated, isLoading, logout, requiresPasswordChange } = useAuth();
  const [activeApp, setActiveApp] = useState<AppId>(() => appIdFromHash() ?? 'dashboard');
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

  const handleResetPasswordClose = () => {
    setResetToken(null);
  };

  const handleResetPasswordSuccess = () => {
    setResetToken(null);
    // Force a logout if they're logged in, so they can login with new password
    if (isAuthenticated) {
      logout();
    }
  };

  const navigate = (appId: AppId) => {
    setActiveApp(appId);
    setHash(appId);
  };

  useEffect(() => {
    const onHashChange = () => {
      const fromHash = appIdFromHash();
      if (fromHash) setActiveApp(fromHash);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <>
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
          <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500"></div>
            <p className="mt-4 text-gray-600">Loading...</p>
          </div>
        </div>
        {resetToken && (
          <ResetPasswordModal
            token={resetToken}
            onClose={handleResetPasswordClose}
            onSuccess={handleResetPasswordSuccess}
          />
        )}
      </>
    );
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return (
      <>
        <Login />
        {resetToken && (
          <ResetPasswordModal
            token={resetToken}
            onClose={handleResetPasswordClose}
            onSuccess={handleResetPasswordSuccess}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Layout activeApp={activeApp} onAppChange={navigate}>
        <Suspense
          fallback={
            <div className="flex h-full min-h-96 items-center justify-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-amber-500"></div>
            </div>
          }
        >
          {activeApp === 'dashboard' && <Dashboard onOpenApp={navigate} />}
          {activeApp === 'aba' && <AbaWorkflow />}
          {activeApp === 'banking' && <Banking />}
          {activeApp === 'payroll' && <Payroll />}
          {activeApp === 'tools' && <Tools />}
          {activeApp === 'forex-tt' && <ForexTTApp />}
          {activeApp === 'public-health' && <PublicHealthApp />}
          {activeApp === 'hr' && <HrApp />}
          {activeApp === 'admin' && <Admin />}
        </Suspense>
      </Layout>
      {resetToken && (
        <ResetPasswordModal
          token={resetToken}
          onClose={handleResetPasswordClose}
          onSuccess={handleResetPasswordSuccess}
        />
      )}
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
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AppContent />
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
