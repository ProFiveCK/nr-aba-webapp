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
 expect(html).toContain('Use Migrated staff to check those already migrated');
});
