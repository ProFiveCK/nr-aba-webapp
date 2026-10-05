import { apiClient } from '../../lib/api';

/** Open the Treasury-approved application as a PDF for printing or filing. */
export async function printApprovedLeaveForm(applicationId: string): Promise<void> {
    // Reserve the tab in the click handler before the authenticated fetch.
    const preview = window.open('', '_blank');
    if (!preview) throw new Error('Allow pop-ups to open the approved leave PDF.');
    preview.opener = null;
    preview.document.write('<!doctype html><title>Preparing leave application</title><p>Preparing PDF…</p>');
    try {
        const pdf = await apiClient.getBlob(`/hr/leaves/${applicationId}/application.pdf`);
        if (preview.closed) return;
        const url = URL.createObjectURL(pdf);
        preview.location.replace(url);
        const release = () => {
            URL.revokeObjectURL(url);
            window.clearInterval(checkClosed);
        };
        const checkClosed = window.setInterval(() => {
            if (preview.closed) release();
        }, 60_000);
        window.addEventListener('pagehide', release, { once: true });
    } catch (error) {
        preview.close();
        throw error;
    }
}
