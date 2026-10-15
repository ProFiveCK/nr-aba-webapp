import { GovernmentRequestList } from '../GovernmentRequests';

export function Approvals() {
    return <GovernmentRequestList mode="queue" includeRecorded />;
}
