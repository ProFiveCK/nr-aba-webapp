import {isReviewRecord,reviewRecordLabel} from './reviewRecordNames';

export function ReviewRecordName({ name }: { name: string }) {
    const friendly = isReviewRecord(name) ? reviewRecordLabel(name) : null;
    return friendly ? <span title={`Recorded reference: ${name}`}>{friendly}{' '}<span className="ml-2 inline-block rounded bg-gray-100 px-2 py-0.5 align-middle text-xs font-normal text-gray-600">Demo</span></span> : <>{name}</>;
}

export function ReviewRecordReference({ name, source }: { name: string; source?: string }) {
    return isReviewRecord(name) ? <details className="text-xs text-gray-500"><summary className="cursor-pointer">Original review reference</summary><p className="mt-2 break-words">{name}</p>{source && <p className="mt-1 break-words">{source}</p>}</details> : source ? <p className="break-words text-sm text-gray-600">{source}</p> : null;
}
