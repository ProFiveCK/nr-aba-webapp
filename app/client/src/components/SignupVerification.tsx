import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../lib/api';
import { Button } from './Ui';

type Outcome = { state: 'checking' } | { state: 'confirmed' | 'failed'; message: string };

/**
 * Opened from the link in the sign-up confirmation email. Confirming the
 * address is what sends the request to an administrator for approval.
 */
export function SignupVerification({ token, onDone }: { token: string; onDone: () => void }) {
    const [outcome, setOutcome] = useState<Outcome>({ state: 'checking' });
    // A link works once; React's development double-run must not spend it twice.
    const sent = useRef(false);

    useEffect(() => {
        if (sent.current) return;
        sent.current = true;
        apiClient.post<{ message?: string }>('/auth/verify-signup', { token }, { suppressAuthExpired: true })
            .then((result) => setOutcome({
                state: 'confirmed',
                message: result?.message || 'Your email is confirmed and your request has gone to an administrator for approval.',
            }))
            .catch((err) => setOutcome({
                state: 'failed',
                message: (err as Error)?.message || 'This confirmation link is invalid or has expired.',
            }));
    }, [token]);

    return (
        <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
            <section className="w-full max-w-md space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <h1 className="text-2xl font-semibold">Confirm your email</h1>
                {outcome.state === 'checking' && <p className="text-gray-600" role="status">Checking your link…</p>}
                {outcome.state === 'confirmed' && (
                    <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{outcome.message}</p>
                )}
                {outcome.state === 'failed' && (
                    <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{outcome.message}</p>
                )}
                {outcome.state !== 'checking' && <Button onClick={onDone}>Go to sign in</Button>}
            </section>
        </main>
    );
}
