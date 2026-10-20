import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import { useAppSections } from '../../components/appChrome';
import { defaultLeaveSection, visibleLeaveSections } from './sections';
import { WorkQueue } from './sections/WorkQueue';
import { Employees } from './sections/Employees';
import { MyLeave } from './sections/MyLeave';
import { Staff } from './sections/Staff';
import { Calendar } from './sections/Calendar';
import { Report } from './sections/Report';

export function LeaveApp() {
    const { user } = useAuth();
    const visible = visibleLeaveSections(user?.permissions);
    const fallback = defaultLeaveSection(user?.permissions);
    // Drawn by the portal's sticky bar, so a long staff list does not scroll
    // the section menu off the screen.
    useAppSections(visible.map((section) => ({ to: `/leave/${section.id}`, label: section.label })));

    // hr_access can be granted on its own, without any of the action
    // capabilities that make a section worth opening.
    if (!fallback) {
        return (
            <div className="leave-workspace min-w-0 space-y-6">
                <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Leave</h2>
                <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
                    <p className="text-sm font-medium text-gray-900">No leave functions are enabled for your account</p>
                    <p className="mt-1 text-sm text-gray-500">Ask an administrator to grant you leave access.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="leave-workspace min-w-0 space-y-6">
            {import.meta.env.VITE_LOCAL_REVIEW_KIND === 'production-copy' && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">Local production copy · Changes stay on this computer. Email, external connections and automatic accrual are disabled.</p>}
            <Routes>
                <Route index element={<Navigate to={fallback} replace />} />
                {visible.some((s) => s.id === 'work-queue') && <><Route path="work-queue" element={<WorkQueue />} /><Route path="approvals" element={<LeaveRedirect to="/leave/work-queue" />} />{user?.permissions?.hr_admin && <Route path="overview" element={<LeaveRedirect to="/leave/work-queue?view=overview" />} />}</>}
                {visible.some((s) => s.id === 'my-leave') && <Route path="my-leave" element={<MyLeave />} />}
                {visible.some((s) => s.id === 'calendar') && <Route path="calendar" element={<Calendar />} />}
                {visible.some((s) => s.id === 'employees') && <><Route path="employees" element={<Employees />} /><Route path="staff" element={<LeaveRedirect to="/leave/employees" />} /></>}
                {(user?.permissions?.hr_admin || user?.permissions?.hr_balance_manage) && <Route path="balances" element={<LeaveRedirect to="/leave/employees?view=balances" />} />}
                {visible.some((s) => s.id === 'report') && <Route path="report" element={<Report />} />}
                {visible.some((s) => s.id === 'settings') && <><Route path="settings" element={<Staff key="settings" workspace="settings" />} /><Route path="policies" element={<Navigate to="/leave/settings?view=policies" replace />} /></>}
                {/* An unknown or forbidden section, including one reached from
                    an old bookmark, falls back rather than showing nothing. */}
                <Route path="*" element={<Navigate to={fallback} replace />} />
            </Routes>
        </div>
    );
}

// Keep old bookmarks and employee filters while normalising the destination.
function LeaveRedirect({ to }: { to: string }) {
    const location = useLocation();
    const [path, search] = to.split('?');
    const params = new URLSearchParams(location.search);
    new URLSearchParams(search).forEach((value, key) => params.set(key, value));
    return <Navigate to={{ pathname: path, search: params.toString() }} replace />;
}
