import { convertGvaChfStatementToFmis, type FmisBuildResult } from '../converters/gvaChfStatementConverter';
import { FmisGenerator } from './FmisGenerator';

function formatSummary(result: FmisBuildResult): string {
    const pieces = [
        `${result.transactionCount} transactions`,
        `${result.debitCount} debits (CHQ)`,
        `${result.creditCount} credits (DEP)`,
    ];
    if (result.skippedRows) pieces.push(`${result.skippedRows} rows skipped`);
    return pieces.join(' • ');
}

export function GvaChfGenerator() {
    return (
        <FmisGenerator
            title="GVA-CHF Statement Generator"
            description="Convert Geneva Mission CHF bank statement CSV exports into TechnologyOne FMIS bank-reconciliation import format."
            accept=".csv,.numbers"
            selectButtonLabel="Select GVA-CHF Statement"
            generateButtonLabel="Generate GVA-CHF Output"
            emptyErrorMessage="Select a Geneva CHF statement file before generating output."
            generateErrorPrefix="Unable to convert Geneva CHF statement."
            downloadBaseName="gva-chf-statement"
            convert={convertGvaChfStatementToFmis}
            formatSummary={formatSummary}
        />
    );
}
