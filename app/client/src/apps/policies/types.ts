/** Policies & Procedures, as the API sends them. */

export interface PolicyType {
    key: string;
    label: string;
}

/** A manual (no parent) or a section of one. Publishers maintain the list. */
export interface PolicyCategory {
    id: string;
    parent_id: string | null;
    name: string;
    sort_order: number;
    /** Documents in the library it holds, a manual counting its sections. */
    document_count: number;
}

/** A category as tagged on a document. */
export interface PolicyTag {
    id: string;
    name: string;
    parent_id: string | null;
    parent_name: string | null;
}

export interface PolicyMeta {
    types: PolicyType[];
    departments: { id: string; name: string }[];
    categories: PolicyCategory[];
    /** Documents in the library for this account, and those in no category. */
    document_count: number;
    uncategorised_count: number;
    can_edit: boolean;
    /** Also maintains the categories. */
    can_publish: boolean;
}

export interface PolicyListItem {
    id: string;
    code: string;
    title: string;
    doc_type: string;
    categories: PolicyTag[];
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
    body_text?: string;
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
    category_ids: string[];
    department_id: string | null;
    review_due: string | null;
}

export interface PolicyDocument extends Omit<PolicyDetails, 'category_ids'> {
    id: string;
    categories: PolicyTag[];
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

/** One reference the library's live texts no longer resolve. */
export interface PolicyReferenceIssue {
    id: string;
    code: string;
    title: string;
    location: 'published' | 'draft';
    target_kind: 'document' | 'file';
    target: string;
    target_label: string | null;
    issue: string;
}
