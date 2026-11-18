/** Policies & Procedures, as the API sends them. */

export interface PolicyType {
    key: string;
    label: string;
}

export interface PolicyMeta {
    types: PolicyType[];
    departments: { id: string; name: string }[];
    categories: string[];
    can_edit: boolean;
    can_publish: boolean;
}

export interface PolicyListItem {
    id: string;
    code: string;
    title: string;
    doc_type: string;
    category: string | null;
    department_id: string | null;
    department_name: string | null;
    review_due: string | null;
    review_overdue: boolean | null;
    retired_at: string | null;
    published_version_no: number | null;
    published_at: string | null;
    /** Only for accounts that write or publish. */
    draft_version_no?: number | null;
    draft_updated_at?: string | null;
    /** A passage around a search match, matched words between ⟦ and ⟧. */
    snippet: string | null;
}

export interface PolicyFile {
    id: string;
    url: string;
    file_name: string;
    content_type: string;
    byte_size: number;
    is_picture: boolean;
}

export interface PolicyVersion {
    id: string;
    version_no: number;
    status: 'draft' | 'published' | 'superseded';
    /** Cleaned by the server before it was stored; safe to show as it is. */
    body_html: string;
    change_summary: string | null;
    revision: number;
    published_at: string | null;
    superseded_at: string | null;
    updated_at: string;
    published_by_name: string | null;
    updated_by_name: string | null;
    attachments: PolicyFile[];
}

export interface PolicyHistoryEntry {
    id: string;
    version_no: number;
    status: 'published' | 'superseded';
    change_summary: string | null;
    published_at: string;
    superseded_at: string | null;
    published_by_name: string | null;
}

export interface PolicyDetails {
    code: string;
    title: string;
    doc_type: string;
    category: string | null;
    department_id: string | null;
    review_due: string | null;
}

export interface PolicyDocument extends PolicyDetails {
    id: string;
    department_name: string | null;
    review_overdue: boolean | null;
    retired_at: string | null;
    retired_reason: string | null;
    retired_by_name: string | null;
    was_published: boolean;
    published: PolicyVersion | null;
    /** Only for accounts that write or publish. */
    draft: PolicyVersion | null;
    versions: PolicyHistoryEntry[];
}
