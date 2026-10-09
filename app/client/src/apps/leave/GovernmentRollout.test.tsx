import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {GovernmentRollout} from './GovernmentRollout';
vi.mock('../../contexts/useAuth',()=>({useAuth:()=>({user:{id:'admin',role:'admin'}})}));
it('starts with awaiting migration and provides a separate completed staff view',()=>{
 const html=renderToStaticMarkup(<MemoryRouter><GovernmentRollout departments={[]}/></MemoryRouter>);
 expect(html).toContain('<option value="legacy" selected="">Awaiting migration</option>');
 expect(html).toContain('<option value="government">Migrated staff</option>');
 expect(html).toContain('<option value="excluded">Contract staff — no leave entitlement</option>');
 expect(html).toContain('Review staff transfer');
 expect(html).not.toContain('Set up automatic balances');
});
it('provides automatic balances only for transferred staff',()=>{
 const html=renderToStaticMarkup(<MemoryRouter><GovernmentRollout departments={[]} mode="balances"/></MemoryRouter>);
 expect(html).toContain('Automatic balances');
 expect(html).not.toContain('Awaiting migration</option>');
 expect(html).not.toContain('Review staff transfer');
});
