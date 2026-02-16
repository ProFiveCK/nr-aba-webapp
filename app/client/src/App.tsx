import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { Login } from './pages/Login';
import { Layout } from './components/Layout';
import { Generator } from './pages/Generator';
import { MyBatches } from './pages/MyBatches';
import { Reader } from './pages/Reader';
import { Banking } from './pages/Banking';
import { Saas } from './pages/Saas';
import { Reviewer } from './pages/Reviewer';
import { Admin } from './pages/Admin';
import { ResetPasswordModal } from './components/ResetPasswordModal';

function AppContent() {
  const { isAuthenticated, isLoading, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('generator');
  const [resetToken, setResetToken] = useState<string | null>(null);

  // Check for password reset token in URL hash
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#reset-password=')) {
      const token = hash.substring('#reset-password='.length);
      if (token) {
        setResetToken(token);
        // Clear the hash from URL
        window.location.hash = '';
      }
    }
  }, []);

  // Set up global auth expiration handler
  useEffect(() => {
    (window as any).handleAuthExpired = () => {
      logout();
      // Optional: show a toast or notification
      console.log('Session expired. Please log in again.');
    };

    return () => {
      delete (window as any).handleAuthExpired;
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
      <Layout activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'generator' && <Generator />}
        {activeTab === 'my-batches' && <MyBatches />}
        {activeTab === 'reader' && <Reader onTabChange={setActiveTab} />}
        {activeTab === 'banking' && <Banking />}
        {activeTab === 'saas' && <Saas />}
        {activeTab === 'reviewer' && <Reviewer onTabChange={setActiveTab} />}
        {activeTab === 'admin' && <Admin />}
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
