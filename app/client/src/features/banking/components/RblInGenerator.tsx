import { convertRblInCsvToFmis, type FmisBuildResult } from '../converters/rblInConverter';
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

export function RblInGenerator() {
    return (
        <FmisGenerator
            title="IND-INR Statement Generator"
            description="Convert RBL Bank India (INR) bank statement CSV exports into TechnologyOne FMIS bank-reconciliation import format."
            accept=".csv"
            selectButtonLabel="Select RBL India CSV"
            generateButtonLabel="Generate IND-INR Output"
            emptyErrorMessage="Select an RBL Bank India CSV file before generating output."
            generateErrorPrefix="Unable to convert RBL India statement."
            downloadBaseName="rbl-india-statement"
            convert={convertRblInCsvToFmis}
            formatSummary={formatSummary}
        />
    );
}