// A production backup may contain live SMTP configuration. This deployment
// control takes precedence over restored settings and cannot be toggled in Admin.
export const localProductionReview = process.env.LOCAL_REVIEW_ONLY === 'production-copy';
if (localProductionReview && (process.env.NODE_ENV !== 'development' || process.env.DB_NAME !== 'leave_production_review')) {
  throw new Error('Production-copy review requires the isolated development database.');
}
