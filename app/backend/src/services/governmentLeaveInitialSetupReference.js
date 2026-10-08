// Reuse the owner's configuration decisions in the existing reconciliation
// workspace. A reference is never authority to aggregate or post a balance.
export async function initialSetupReference(client) {
  const { rows: [setup] } = await client.query(`SELECT s.id,s.status,s.plan,p.label AS policy_label
    FROM hr_gov_initial_setups s LEFT JOIN hr_gov_policy_versions p ON p.id=(s.plan->>'policy_id')::uuid
    WHERE s.status IN ('draft','adopted') ORDER BY (s.status='adopted') DESC,s.updated_at DESC,s.id DESC LIMIT 1`);
  if (!setup) return null;
  return { id: setup.id, status: setup.status, policy_id: setup.plan.policy_id, policy_label: setup.policy_label,
    start_date: setup.plan.start_date, mappings: setup.plan.mappings };
}
