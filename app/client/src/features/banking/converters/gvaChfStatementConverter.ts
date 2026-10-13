import { convertGvaStatementToFmis, type FmisBuildResult } from './gvaStatementConverter';

export type { FmisBuildResult } from './gvaStatementConverter';

const DEFAULT_ACCOUNT = '0279 00321139.01';

export function convertGvaChfStatementToFmis(text: string, fallbackAccount: string = DEFAULT_ACCOUNT): FmisBuildResult {
    return convertGvaStatementToFmis(text, fallbackAccount);
}
