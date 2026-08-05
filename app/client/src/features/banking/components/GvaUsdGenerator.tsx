import { convertGvaUsdStatementToFmis, type FmisBuildResult } from '../converters/gvaUsdStatementConverter';
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

export function GvaUsdGenerator() {
    return (
        <FmisGenerator
            title="GVA-USD Statement Generator"
            description="Convert Geneva Mission USD bank statement CSV exports into TechnologyOne FMIS bank-reconciliation import format."
            accept=".csv,.numbers"
            selectButtonLabel="Select GVA-USD Statement"
            generateButtonLabel="Generate GVA-USD Output"
            emptyErrorMessage="Select a Geneva USD statement file before generating output."
            generateErrorPrefix="Unable to convert Geneva USD statement."
            downloadBaseName="gva-usd-statement"
            convert={convertGvaUsdStatementToFmis}
            formatSummary={formatSummary}
        />
    );
}
