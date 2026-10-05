import { apiClient } from '../../lib/api';
import type { LeaveAttachment } from './types';

/** What a 10MB server-side limit looks like to someone choosing a file. */
export const LEAVE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const LEAVE_ATTACHMENT_MAX_FILES = 5;
export const LEAVE_ATTACHMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.doc,.docx';

/** "412 KB" — enough for someone to tell two versions of a scan apart. */
export function formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Saves a supporting document to the viewer's machine.
 *
 * Fetched as a blob rather than linked to directly: the endpoint is
 * authenticated with a bearer token, which a plain `<a href>` would not send.
 */
export async function downloadLeaveAttachment(
    applicationId: string,
    attachment: LeaveAttachment
): Promise<void> {
    const blob = await apiClient.getBlob(`/hr/leaves/${applicationId}/attachments/${attachment.id}`);
    const url = URL.createObjectURL(blob);
    try {
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.file_name;
        link.click();
    } finally {
        // Given to the browser before it is revoked; a tick is enough for the
        // download to have taken hold of it.
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}
