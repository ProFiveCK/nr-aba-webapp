import { ServiceError } from '../lib/serviceError.js';

// Routine configuration can be completed by the system administrator. This
// authority does not apply to an employee's leave decision or clinical review.
// Callers also recheck current central-HR capabilities before using this helper.
export async function configurationReviewMode(client, { user, actor, preparedBy, initialReview = false }) {
    if (actor.id !== user.id) throw new ServiceError(403, 'The configuration reviewer must match the signed-in account.');
    if (preparedBy !== user.id) return 'independent_hr';
    if (initialReview) return 'initial_admin';
    const { rows: [account] } = await client.query('SELECT role,status,onboarding_state FROM reviewers WHERE id=$1 FOR SHARE', [user.id]);
    if (account?.role !== 'admin' || account.status !== 'active' || account.onboarding_state !== 'ready') throw new ServiceError(403, 'A different central HR officer or an active system administrator must approve this configuration.');
    return 'administrator';
}
