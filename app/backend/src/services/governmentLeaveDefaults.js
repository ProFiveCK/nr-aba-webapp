// New personnel follow the adopted Government setup. Existing personnel still
// require their reviewed transfer; this does not create openings or activation.
// Call inside the creation transaction, before locking personnel/organisation.
export async function newEmployeeLeaveRegime(client) {
  await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('hr-government-initial-setup'))");
  const { rows: [setup] } = await client.query("SELECT EXISTS(SELECT 1 FROM hr_gov_initial_setups WHERE status='adopted') AS adopted");
  return setup.adopted ? 'government' : 'legacy';
}
