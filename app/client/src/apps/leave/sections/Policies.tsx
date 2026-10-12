import { GovernmentFoundation } from '../GovernmentFoundation';

export function Policies() {
    return <div className="space-y-5">
        <h2 className="text-xl font-semibold text-gray-950">Policy & calendars</h2>
        <GovernmentFoundation view="policies" />
    </div>;
}
