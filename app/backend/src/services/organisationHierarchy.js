import {withTransaction} from '../lib/transaction.js';
import {ServiceError} from '../lib/serviceError.js';
import {recordAudit} from './auditService.js';

export async function initOrganisationHierarchySchema(client){
 await client.query(`
  ALTER TABLE hr_divisions ADD COLUMN IF NOT EXISTS parent_division_id UUID;
  DO $$ BEGIN
   IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='hr_divisions_parent_department_fk') THEN
    ALTER TABLE hr_divisions ADD CONSTRAINT hr_divisions_parent_department_fk FOREIGN KEY(parent_division_id,department_id) REFERENCES hr_divisions(id,department_id) ON DELETE RESTRICT;
    ALTER TABLE hr_divisions ADD CONSTRAINT hr_divisions_not_own_parent CHECK(parent_division_id IS NULL OR parent_division_id<>id);
   END IF;
  END $$;
  CREATE INDEX IF NOT EXISTS idx_hr_divisions_parent ON hr_divisions(parent_division_id);
  CREATE OR REPLACE FUNCTION hr_division_hierarchy_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
  BEGIN
   IF TG_OP='UPDATE' AND NEW.parent_division_id IS DISTINCT FROM OLD.parent_division_id THEN
    RAISE EXCEPTION 'Recorded organisation ancestry cannot be rewritten; create the correct division and move staff explicitly.' USING ERRCODE='23514';
   END IF;
   IF NEW.parent_division_id IS NOT NULL AND EXISTS(SELECT 1 FROM hr_divisions p WHERE p.id=NEW.parent_division_id AND p.parent_division_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Choose a parent unit directly under the department.' USING ERRCODE='23514';
   END IF;
   RETURN NEW;
  END $guard$;
  DROP TRIGGER IF EXISTS hr_division_hierarchy_guard ON hr_divisions;
  CREATE TRIGGER hr_division_hierarchy_guard BEFORE INSERT OR UPDATE OF parent_division_id ON hr_divisions FOR EACH ROW EXECUTE FUNCTION hr_division_hierarchy_guard();
 `);
}
export async function initParentApproverSchema(client){
 await client.query(`
  ALTER TABLE hr_approval_assignments DROP CONSTRAINT IF EXISTS hr_approval_assignments_level_check;
  ALTER TABLE hr_approval_assignments ADD CONSTRAINT hr_approval_assignments_level_check CHECK(level IN ('division','parent_division','department','chief_secretary'));
  ALTER TABLE hr_approval_assignments DROP CONSTRAINT IF EXISTS hr_approval_assignments_check1;
  ALTER TABLE hr_approval_assignments DROP CONSTRAINT IF EXISTS hr_approval_assignments_scope_check;
  ALTER TABLE hr_approval_assignments ADD CONSTRAINT hr_approval_assignments_scope_check CHECK(
   (level IN ('division','parent_division') AND department_id IS NOT NULL AND division_id IS NOT NULL)
   OR (level='department' AND department_id IS NOT NULL AND division_id IS NULL)
   OR (level='chief_secretary' AND department_id IS NULL AND division_id IS NULL));
 `);
}
export async function divisionPlacementIssue(client,divisionId){
 if(!divisionId)return null;
 const {rows:[node]}=await client.query('SELECT name,EXISTS(SELECT 1 FROM hr_divisions c WHERE c.parent_division_id=v.id) AS has_children FROM hr_divisions v WHERE v.id=$1',[divisionId]);
 return node?.has_children?`Choose the employee’s actual division under ${node.name} in Employee details. ${node.name} is the parent unit.`:null;
}
export async function createOrganisationDivision(pool,{departmentId,name,parentDivisionId=null,actor}){
 return withTransaction(pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-approval-assignments'))");
  const {rows:[department]}=await client.query('SELECT id,name FROM hr_departments WHERE id=$1 FOR SHARE',[departmentId]);
  if(!department)throw new ServiceError(404,'Department not found.');
  if(parentDivisionId){
   const {rows:[parent]}=await client.query('SELECT id,parent_division_id FROM hr_divisions WHERE id=$1 AND department_id=$2 FOR SHARE',[parentDivisionId,departmentId]);
   if(!parent||parent.parent_division_id)throw new ServiceError(400,'Choose a parent unit directly under this department, such as Treasury under Finance.');
  }
  let created;
  try{created=(await client.query('INSERT INTO hr_divisions(department_id,name,parent_division_id) VALUES($1,$2,$3) RETURNING id,name,parent_division_id',[departmentId,name.trim(),parentDivisionId])).rows[0];}
  catch(error){if(error.code==='23505')throw new ServiceError(409,'That division already exists in this department.');throw error;}
  await recordAudit({client,actor,action:'hr.division.created',entityType:'hr_division',entityId:created.id,after:{...created,department:department.name}});
  return created;
 });
}
