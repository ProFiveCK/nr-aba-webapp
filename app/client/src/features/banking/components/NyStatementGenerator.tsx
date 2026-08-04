import { convertNyStatementToFmis, type FmisBuildResult } from '../converters/nyStatementConverter';
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

export function NyStatementGenerator() {
    return (
        <FmisGenerator
            title="NY Statement Generator"
            description="Convert New York USD bank statement CSV files into TechnologyOne FMIS bank-reconciliation import format."
            accept=".csv"
            selectButtonLabel="Select NY Statement CSV"
            generateButtonLabel="Generate NY Statement Output"
            emptyErrorMessage="Select an NY statement CSV file before generating output."
            generateErrorPrefix="Unable to convert NY statement."
            downloadBaseName="ny-statement"
            convert={convertNyStatementToFmis}
            formatSummary={formatSummary}
        />
    );
}
