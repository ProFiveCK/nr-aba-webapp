import { convertWbcFjCsvToFmis, type FmisBuildResult } from '../converters/wbcFjConverter';
import { FmisGenerator } from './FmisGenerator';

function formatSummary(result: FmisBuildResult): string {
    const pieces = [
        `${result.transactionCount} transactions`,
        `${result.debitCount} debits (C001)`,
        `${result.creditCount} credits (D001)`,
    ];
    if (result.skippedRows) pieces.push(`${result.skippedRows} rows skipped`);
    return pieces.join(' • ');
}

export function WbcFjGenerator() {
    return (
        <FmisGenerator
            title="WBCFJ Generator"
            description="Convert Westpac Fiji bank statement CSV files into TechnologyOne FMIS bank-reconciliation import format."
            accept=".csv"
            selectButtonLabel="Select WBC Fiji CSV"
            generateButtonLabel="Generate WBCFJ Output"
            emptyErrorMessage="Select a WBC Fiji CSV file before generating output."
            generateErrorPrefix="Unable to convert WBC Fiji statement."
            downloadBaseName="wbc-fiji-statement"
            convert={convertWbcFjCsvToFmis}
            formatSummary={formatSummary}
        />
    );
}
