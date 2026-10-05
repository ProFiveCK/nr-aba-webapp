import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import { defaultLeaveSection, visibleLeaveSections, type LeaveSection } from './sections';
import { Overview } from './sections/Overview';
import { MyLeave } from './sections/MyLeave';
import { Approvals } from './sections/Approvals';
import { Staff } from './sections/Staff';
import { Policies } from './sections/Policies';
import { Calendar } from './sections/Calendar';
import { Report } from './sections/Report';

export function LeaveApp() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const visible = visibleLeaveSections(user?.permissions);
    const fallback = defaultLeaveSection(user?.permissions);

    // hr_access can be granted on its own, without any of the action
    // capabilities that make a section worth opening.
    if (!fallback) {
        return (
            <div className="space-y-5">
                <h2 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Leave</h2>
                <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
                    <p className="text-sm font-medium text-zinc-900">No leave functions are enabled for your account</p>
                    <p className="mt-1 text-sm text-zinc-500">Ask an administrator to grant you leave access.</p>
                </div>
            </div>
        );
    }

    // Overview's exception rows jump to the section that answers them.
    const goToSection = (section: LeaveSection) => navigate(`/leave/${section}`);

    return (
        <div className="space-y-5">
            {/* Leave owns its header, so the title and its sections read as one
                block. The portal chrome above is the only thing it shares. */}
            <div className="border-b border-slate-200">
                <h2 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Leave</h2>
                <nav aria-label="Leave sections" className="-mb-px mt-3 flex gap-6 overflow-x-auto [scrollbar-width:none]">
                    {visible.map((section) => (
                        <NavLink
                            key={section.id}
                            to={`/leave/${section.id}`}
                            className={({ isActive }) => `shrink-0 whitespace-nowrap border-b-2 pb-2.5 pt-1 text-sm font-medium transition-colors ${
                                isActive
                                    ? 'border-[#E8842C] text-[#002B7F]'
                                    : 'border-transparent text-slate-600 hover:text-[#002B7F]'
                            }`}
                        >
                            {section.label}
                        </NavLink>
                    ))}
                </nav>
            </div>

            <Routes>
                <Route index element={<Navigate to={fallback} replace />} />
                {visible.some((s) => s.id === 'overview') && <Route path="overview" element={<Overview onNavigate={goToSection} />} />}
                {visible.some((s) => s.id === 'my-leave') && <Route path="my-leave" element={<MyLeave />} />}
                {visible.some((s) => s.id === 'approvals') && <Route path="approvals" element={<Approvals />} />}
                {visible.some((s) => s.id === 'calendar') && <Route path="calendar" element={<Calendar />} />}
                {visible.some((s) => s.id === 'staff') && <Route path="staff" element={<Staff />} />}
                {visible.some((s) => s.id === 'report') && <Route path="report" element={<Report />} />}
                {visible.some((s) => s.id === 'policies') && <Route path="policies" element={<Policies />} />}
                {/* An unknown or forbidden section, including one reached from
                    an old bookmark, falls back rather than showing nothing. */}
                <Route path="*" element={<Navigate to={fallback} replace />} />
            </Routes>
        </div>
    );
}
