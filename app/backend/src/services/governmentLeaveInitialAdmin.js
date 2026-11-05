// The one-time initial staff migration let the administrator approve their own
// opening balances while it ran. That migration has been removed, so no
// request is ever inside it; this stays only until openings are saved in one step.
export function initialAdminReview() {
 return null;
}
