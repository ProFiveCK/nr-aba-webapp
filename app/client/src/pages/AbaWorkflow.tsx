import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Generator } from '../pages/Generator';
import { MyBatches } from '../pages/MyBatches';
import { Reader } from '../pages/Reader';
import { Reviewer } from '../pages/Reviewer';
import { useAuth } from '../contexts/useAuth';
import { useAppSections } from '../components/appChrome';

type AbaTab = 'generator' | 'my-batches' | 'reader' | 'reviewer';
type Role = 'user' | 'banking' | 'reviewer' | 'admin' | 'payroll' | 'public_health';

const ALL_TABS: { id: AbaTab; label: string; roles: Role[] }[] = [
  { id: 'generator', label: 'Generator', roles: ['user', 'reviewer', 'admin'] },
  { id: 'my-batches', label: 'My Batches', roles: ['user', 'reviewer', 'admin'] },
  { id: 'reader', label: 'Reader', roles: ['user', 'reviewer', 'admin'] },
  { id: 'reviewer', label: 'Repository', roles: ['reviewer', 'admin'] },
];

export function AbaWorkflow() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const tabs = ALL_TABS.filter((tab) => user?.role && tab.roles.includes(user.role));

  // The portal's sticky bar draws these; the app only says what they are.
  useAppSections(tabs.map((tab) => ({ to: `/aba/${tab.id}`, label: tab.label })));

  const fallback = tabs[0]?.id;
  if (!fallback) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <h2 className="text-xl font-semibold">ABA access required</h2>
        <p className="mt-2 text-sm text-amber-800">No ABA functions are enabled for your account.</p>
      </div>
    );
  }
  const has = (id: AbaTab) => tabs.some((tab) => tab.id === id);

  return (
    <Routes>
      <Route index element={<Navigate to={fallback} replace />} />
      {has('generator') && <Route path="generator" element={<Generator />} />}
      {has('my-batches') && <Route path="my-batches" element={<MyBatches />} />}
      {has('reader') && <Route path="reader" element={<Reader onSwitchToGenerator={() => navigate('/aba/generator')} />} />}
      {has('reviewer') && <Route path="reviewer" element={<Reviewer onSwitchToReader={() => navigate('/aba/reader')} />} />}
      <Route path="*" element={<Navigate to={fallback} replace />} />
    </Routes>
  );
}
