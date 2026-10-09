import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ReactNode} from 'react';
import {ActionDialog} from './ManagementFields';

vi.mock('../../components/Ui',async()=>{
 const original=await vi.importActual<typeof import('../../components/Ui')>('../../components/Ui');
 // The portal modal manages browser focus; the form contract is tested here.
 return {...original,Modal:({children}:{children:ReactNode})=><>{children}</>};
});
const noop=()=>{};
const save=async()=>{};
it('routine setup has an optional note while keeping the actual setup fields required',()=>{
 const html=renderToStaticMarkup(<ActionDialog title="Assign officeholder" automaticReason="Nominated the recorded leave officeholder." onClose={noop} onSave={save}><input name="approver_employee_id" required/></ActionDialog>);
 expect(html).toContain('Add a setup note (optional)');
 expect(html).not.toContain('Verification reason');
 expect(html).not.toContain('name="reason"');
 const nominee=html.match(/<input[^>]*name="approver_employee_id"[^>]*>/)?.[0];
 expect(nominee).toBeDefined();expect(nominee).toContain('required');
 const note=html.match(/<textarea[^>]*name="setup_note"[^>]*>/)?.[0];
 expect(note).toBeDefined();expect(note).not.toContain('required');
});
it('a correction still requires its verification reason and retains a provided explanation',()=>{
 const html=renderToStaticMarkup(<ActionDialog title="Correct balance" defaultReason="Correction supported by the reviewed balance record." onClose={noop} onSave={save}><input name="amount" required/></ActionDialog>);
 expect(html).toContain('Verification reason');
 expect(html).toMatch(/name="reason"[^>]*required/);
 expect(html).toContain('Correction supported by the reviewed balance record.');
 expect(html).not.toContain('Add a setup note (optional)');
});
