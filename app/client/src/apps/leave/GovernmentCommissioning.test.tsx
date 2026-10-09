import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {RosterReview} from './GovernmentCommissioning';

const person={employee_id:'example',display_name:'Recorded employee',payroll_id:null,targets:[{code:'medical',amount:'8',sources:[{id:'source',name:'Sick with MC',year:2026,balance:'8',pending:'0'}]}],warnings:['Payroll ID is unverified.'],issues:[]};
it('renders a frozen database review whose route is an object without crashing',()=>{
 const html=renderToStaticMarkup(<MemoryRouter><RosterReview people={[{...person,route:{stages:[{level:'division',label:'Divisional Chief'}]}}]}/></MemoryRouter>);
 expect(html).toContain('Divisional Chief');expect(html).toContain('medical: 8 days');expect(html).toContain('Payroll ID is unverified.');
});
it('also renders the route array returned by a fresh preview',()=>{
 const html=renderToStaticMarkup(<MemoryRouter><RosterReview people={[{...person,route:[{level:'division',label:'Division'},{level:'parent_division',label:'Treasury'}]}]}/></MemoryRouter>);
 expect(html).toContain('Division → Treasury');
});

it('explains that approved future leave keeps its approval and has already reduced the shown balance',()=>{
 const html=renderToStaticMarkup(<MemoryRouter><RosterReview people={[{...person,route:[],approved_leave:[{legacy_request_id:'approved-source',code:'recreation',start_date:'2026-10-19',end_date:'2026-10-30',days:'10',approved_by_name:'Original approver'}]}]}/></MemoryRouter>);
 expect(html).toContain('Existing approval retained');expect(html).toContain('Original approver');expect(html).toContain('already deducted from the shown balance');
});
