import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiClient } from '../lib/api';
import { Button } from './Ui';

export function EmployeeActivation({ token,onDone }: { token:string;onDone:()=>void }) {
    const [password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[complete,setComplete]=useState(false);
    async function submit(event:FormEvent) {
        event.preventDefault();setError('');
        if(password!==confirmation){setError('Passwords do not match.');return;}
        setBusy(true);
        try {await apiClient.post('/auth/activate-leave',{token,new_password:password},{suppressAuthExpired:true});setPassword('');setConfirmation('');setComplete(true);} catch(err){setError((err as Error).message);} finally{setBusy(false);}
    }
    return <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4"><section className="w-full max-w-md space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"><h1 className="text-2xl font-semibold">Set your employee password</h1>{complete ? <><p>Your account is ready. Sign in with your verified email or assigned Payroll ID and the password you chose.</p><Button onClick={onDone}>Return to sign in</Button></> : <><p className="text-sm text-gray-600">Use the individual activation or recovery link provided by HR. It expires after two hours and can be used once.</p>{error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}<form onSubmit={submit} className="space-y-4"><label className="block text-sm font-medium">New password<input type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={password} onChange={e=>setPassword(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 p-3" disabled={busy} /></label><label className="block text-sm font-medium">Confirm password<input type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={confirmation} onChange={e=>setConfirmation(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 p-3" disabled={busy} /></label><p className="text-xs text-gray-500">At least 12 characters. Payroll IDs are identifiers; choose a separate password.</p><Button type="submit" loading={busy}>Set password and activate</Button><Button variant="secondary" onClick={onDone} disabled={busy}>Return to sign in</Button></form></>}</section></main>;
}
