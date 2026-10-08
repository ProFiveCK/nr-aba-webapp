// Exact fixture labels only. Stored names, evidence and exports retain their original references.
const exampleNames: Record<string, string> = {
    'Synthetic Package 2 review schedule': 'Example government leave rules',
    'Synthetic Package 2 calendar': 'Example holiday calendar',
    'Synthetic holiday for charge verification': 'Example holiday (fictional)',
    'Synthetic 1C Week': 'Example eight-hour working week',
    'Synthetic Standard Office': 'Example seven-hour working week',
    'Synthetic 1E Alias Employee': 'Demo employee — Payroll ID sign-in',
    'Synthetic 1E Email Employee': 'Demo employee — email sign-in',
    'Synthetic 1E Existing Account Employee': 'Demo employee — existing account',
    'Synthetic 1C Browser Employee': 'Demo employee — temporary intern',
    'Synthetic 1D Outside Employee': 'Demo employee — another department',
    'Synthetic 1D Scope Test Employee': 'Demo employee — department access review',
    'Synthetic Government Division Approver': 'Demo division approver',
    'Synthetic Government HOD': 'Demo Head of Department',
    'Synthetic Relevant Secretary': 'Demo relevant Secretary',
    'Synthetic Government Chief Secretary': 'Demo Chief Secretary',
    'Synthetic Chief Secretary': 'Demo Chief Secretary — configured officeholder',
    'Synthetic Department Head': 'Demo department head',
    'Synthetic Divisional Officeholder': 'Demo divisional officeholder',
    'Synthetic Existing Employee': 'Demo employee — existing record',
    'Synthetic Same Name': 'Demo employee — matching name',
    'Synthetic Scoped HR Officer': 'Demo department HR officer',
    'Synthetic Onboarding': 'Example department',
    'Synthetic Administration': 'Example administration division',
    'Synthetic Onboarding Division': 'Example HR division',
    'Synthetic Package 6 Alias Employee rehearsal': 'Example employee rollout review',
};


export function isReviewRecord(name: string) { return Object.hasOwn(exampleNames, name); }
export function reviewRecordLabel(name: string) { return isReviewRecord(name) ? exampleNames[name] : name; }
