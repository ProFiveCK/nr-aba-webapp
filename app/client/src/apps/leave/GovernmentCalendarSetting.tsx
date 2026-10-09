import {useEffect,useState} from 'react';
import {apiClient} from '../../lib/api';
type Setting={require_calendar_coverage:boolean;revision:number};

export function CalendarRequirement({checked,disabled,onChange}:{checked:boolean;disabled:boolean;onChange:(checked:boolean)=>void}){
 return <div className="space-y-2 rounded-lg border border-gray-200 p-3">
  <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)} className="mt-1"/>Require a published holiday calendar for leave calculations</label>
  <p className="text-sm text-gray-600">When unticked, leave calculations use the recorded work schedule for dates without a calendar. Holidays in entered calendars still apply. Tick to require calendar coverage before employee setup or leave applications can be completed.</p>
 </div>;
}
export function GovernmentCalendarSetting({onChanged}:{onChanged?:()=>void}){
 const [setting,setSetting]=useState<Setting|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let live=true;void apiClient.get<Setting>('/hr/government/calendar-settings').then(s=>{if(live)setSetting(s);}).catch((e:Error)=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
 async function save(checked:boolean){
  if(!setting)return;
  setBusy(true);setError('');
  try{setSetting(await apiClient.put<Setting>('/hr/government/calendar-settings',{require_calendar_coverage:checked,expected_revision:setting.revision}));onChanged?.();}
  catch(e){setError((e as Error).message);}
  finally{setBusy(false);}
 }
 return <div className="space-y-2"><CalendarRequirement checked={setting?.require_calendar_coverage??false} disabled={!setting||busy} onChange={checked=>void save(checked)}/>{!setting&&!error&&<p role="status" className="text-xs text-gray-500">Loading calendar preference…</p>}{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}</div>;
}
