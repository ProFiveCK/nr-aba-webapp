import { convertGvaStatementToFmis, type FmisBuildResult } from './gvaStatementConverter';

export type { FmisBuildResult } from './gvaStatementConverter';

const DEFAULT_ACCOUNT = '0279 00321139.60';

export function convertGvaUsdStatementToFmis(text: string, fallbackAccount: string = DEFAULT_ACCOUNT): FmisBuildResult {
    return convertGvaStatementToFmis(text, fallbackAccount);
}
