import { useState } from 'react';
import { Paperclip } from 'lucide-react';
import { downloadLeaveAttachment, formatFileSize } from './leaveAttachments';
import type { LeaveApplication } from './types';

/**
 * The supporting documents filed with a leave application, as download links.
 *
 * Shared by the applicant's own list and the approver's queue so the approver
 * sees exactly the documents the applicant attached. Renders nothing when
 * there are none, so it can be dropped into a row unconditionally.
 */
export function LeaveAttachmentLinks({
    application,
    onError,
}: {
    application: LeaveApplication;
    onError: (message: string) => void;
}) {
    const [busyId, setBusyId] = useState<string | null>(null);
    const attachments = application.attachments ?? [];
    if (!attachments.length) return null;

    const open = async (attachmentId: string) => {
        const attachment = attachments.find((item) => item.id === attachmentId);
        if (!attachment) return;
        setBusyId(attachmentId);
        try {
            await downloadLeaveAttachment(application.id, attachment);
        } catch (err) {
            onError((err as Error)?.message || 'Unable to download the attachment.');
        } finally {
            setBusyId(null);
        }
    };

    return (
        <ul className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {attachments.map((attachment) => (
                <li key={attachment.id}>
                    <button
                        type="button"
                        onClick={() => void open(attachment.id)}
                        disabled={busyId === attachment.id}
                        className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline disabled:opacity-50"
                    >
                        <Paperclip size={13} aria-hidden="true" />
                        {attachment.file_name}
                        {attachment.byte_size > 0 && (
                            <span className="font-normal text-gray-500">({formatFileSize(attachment.byte_size)})</span>
                        )}
                    </button>
                </li>
            ))}
        </ul>
    );
}
