import dotenv from 'dotenv';

dotenv.config();

const fallbackMonths = 12;
const rawMonths = Number(process.env.BATCH_ARCHIVE_RETENTION_MONTHS || fallbackMonths);

export const BATCH_ARCHIVE_RETENTION_MONTHS =
  Number.isFinite(rawMonths) && rawMonths > 0 ? rawMonths : fallbackMonths;

export function getArchiveRetentionInterval() {
  return `${BATCH_ARCHIVE_RETENTION_MONTHS} months`;
}

export function getArchiveCutoffDate(referenceDate = new Date()) {
  const date = new Date(referenceDate);
  date.setMonth(date.getMonth() - BATCH_ARCHIVE_RETENTION_MONTHS);
  return date;
}
