import type { OrgDepartment, OrgDivision } from './types';

/** The reference endpoint is complete; filter before paging so every existing division is searchable. */
export function filterDepartments(departments: OrgDepartment[], search: string): OrgDepartment[] {
    const query = search.trim().toLocaleLowerCase();
    return departments.filter((department) => !query || [department.name, ...department.divisions.map((division) => division.name)]
        .some((name) => name.toLocaleLowerCase().includes(query)))
        .sort((a, b) => a.name.localeCompare(b.name, 'en-AU', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}

export function organisationPage<T>(rows: T[], requestedPage: number, pageSize = 10) {
    const pageCount = Math.ceil(rows.length / pageSize);
    const page = Math.max(0, Math.min(requestedPage, pageCount - 1));
    return { rows: rows.slice(page * pageSize, (page + 1) * pageSize), page, pageCount, total: rows.length, pageSize };
}

export function appointmentTiming(from: string, through: string | null, today: string): 'current' | 'upcoming' | 'ended' {
    return from.slice(0, 10) > today ? 'upcoming' : through && through.slice(0, 10) < today ? 'ended' : 'current';
}

/** Omit unset UUID/enum filters: the API validates optional parameters when they are present. */
export function organisationQuery(page: number, filters: { search?: string; department_id?: string; level?: string; timing?: string; scope?: string }) {
    const query = new URLSearchParams({ page: String(page + 1), page_size: '10' });
    for (const [key, value] of Object.entries(filters)) {
        if (value?.trim()) query.set(key, value.trim());
    }
    return query;
}

/** The middle unit (Treasury) is distinct from its employee divisions. */
export function divisionPath(division: OrgDivision): string {
    return division.parent_division_name ? `${division.parent_division_name} → ${division.name}` : division.name;
}
export function orderedDivisions(divisions: OrgDivision[]): OrgDivision[] {
    const byName = (a: OrgDivision, b: OrgDivision) => a.name.localeCompare(b.name, 'en-AU') || a.id.localeCompare(b.id);
    const roots = divisions.filter(d => !d.parent_division_id).sort(byName);
    const grouped = roots.flatMap(root => [root, ...divisions.filter(d => d.parent_division_id === root.id).sort(byName)]);
    return [...grouped, ...divisions.filter(d => !grouped.some(g => g.id === d.id)).sort(byName)];
}
