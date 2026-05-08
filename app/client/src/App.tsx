import { lazy, Suspense, useEffect, useState } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/useAuth';
import { ToastProvider } from './contexts/ToastContext';
import { Login } from './pages/Login';
import { Layout } from './components/Layout';
import { ResetPasswordModal } from './components/ResetPasswordModal';

const Generator = lazy(() => import('./pages/Generator').then((module) => ({ default: module.Generator })));
const MyBatches = lazy(() => import('./pages/MyBatches').then((module) => ({ default: module.MyBatches })));
const Reader = lazy(() => import('./pages/Reader').then((module) => ({ default: module.Reader })));
const Banking = lazy(() => import('./pages/Banking').then((module) => ({ default: module.Banking })));
const Payroll = lazy(() => import('./pages/Payroll').then((module) => ({ default: module.Payroll })));
const Saas = lazy(() => import('./pages/Saas').then((module) => ({ default: module.Saas })));
const Reviewer = lazy(() => import('./pages/Reviewer').then((module) => ({ default: module.Reviewer })));
const Admin = lazy(() => import('./pages/Admin').then((module) => ({ default: module.Admin })));

const ROLE_TABS: Record<string, string[]> = {
  user: ['generator', 'my-batches', 'reader'],
  banking: ['generator', 'my-batches', 'reader', 'banking'],
  reviewer: ['generator', 'my-batches', 'reader', 'banking', 'saas', 'reviewer'],
  admin: ['generator', 'my-batches', 'reader', 'banking', 'payroll', 'saas', 'reviewer', 'admin'],
  payroll: ['payroll'],
};

function getDefaultTab(role?: string | null) {
  return ROLE_TABS[role || '']?.[0] || 'generator';
}

declare global {
  interface Window {
    handleAuthExpired?: () => void;
  }
}

function AppContent() {
  const { isAuthenticated, isLoading, logout, user } = useAuth();
  const [activeTab, setActiveTab] = useState('generator');
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

  const allowedTabs = ROLE_TABS[user?.role || ''] || [];
  const resolvedActiveTab = allowedTabs.includes(activeTab) ? activeTab : getDefaultTab(user?.role);

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

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <>
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
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

  // Show main app if authenticated
  return (
    <>
      <Layout activeTab={resolvedActiveTab} onTabChange={setActiveTab}>
        <Suspense
          fallback={
            <div className="flex h-full min-h-96 items-center justify-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600"></div>
            </div>
          }
        >
          {resolvedActiveTab === 'generator' && <Generator />}
          {resolvedActiveTab === 'my-batches' && <MyBatches />}
          {resolvedActiveTab === 'reader' && <Reader onTabChange={setActiveTab} />}
          {resolvedActiveTab === 'banking' && <Banking />}
          {resolvedActiveTab === 'payroll' && <Payroll />}
          {resolvedActiveTab === 'saas' && <Saas />}
          {resolvedActiveTab === 'reviewer' && <Reviewer onTabChange={setActiveTab} />}
          {resolvedActiveTab === 'admin' && <Admin />}
        </Suspense>
      </Layout>
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

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
