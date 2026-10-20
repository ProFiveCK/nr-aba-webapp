import {formatDate} from '../../lib/date';

// A bounded DATE keeps all existing policy comparisons and snapshots compatible.
export const POLICY_NO_END_DATE = '9999-12-31';
export const policyEndLabel = (date: string) => date === POLICY_NO_END_DATE ? 'No end date' : formatDate(date);
