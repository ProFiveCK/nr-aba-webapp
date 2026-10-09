export interface PlanningEmployee {
    id: string;
    display_name: string;
    department_code: string | null;
    division_code: string | null;
    balances: Record<string, { balance: number; pending: number }>;
}
export interface PlanningReport { year: number; employees: PlanningEmployee[] }
export interface LeavePlanningRow {
    id: string;
    display_name: string;
    department_code: string | null;
    division_code: string | null;
    staffCount: number;
    recreation: number | null;
    medical: number | null;
    special: number | null;
    pending: number;
}
const available = (employee: PlanningEmployee, names: string[]) => {
    const balances = names.flatMap(name => employee.balances[name] ? [employee.balances[name]] : []);
    return balances.length ? balances.reduce((sum, b) => sum + Math.max(0, Number(b.balance) - Number(b.pending)), 0) : null;
};
export function summarizeLeavePlanning(employees: PlanningEmployee[]) {
    const rows: LeavePlanningRow[] = employees.map(employee => ({
        id: employee.id, display_name: employee.display_name,
        department_code: employee.department_code, division_code: employee.division_code,
        staffCount: 1,
        recreation: available(employee, ['Recreation', 'Annual']),
        medical: available(employee, ['Medical', 'Sick (with MC)', 'Sick (without MC)']),
        special: available(employee, ['Special']),
        pending: Object.values(employee.balances).reduce((n, b) => n + Number(b.pending), 0),
    }));
    const departments = new Map<string, LeavePlanningRow>();
    for (const row of rows) {
        const name = row.department_code || 'Unassigned';
        const group = departments.get(name) ?? {
            id: name, display_name: name, department_code: name, division_code: null,
            staffCount: 0, recreation: null, medical: null, special: null, pending: 0,
        };
        group.staffCount += 1;
        for (const key of ['recreation', 'medical', 'special'] as const) {
            if (row[key] !== null) group[key] = (group[key] ?? 0) + row[key];
        }
        group.pending += row.pending;
        departments.set(name, group);
    }
    return { rows, departments: [...departments.values()] };
}
