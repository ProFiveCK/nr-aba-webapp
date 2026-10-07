// Status comes from the policy record. Keep the original saved name in history
// and source references while removing an obsolete draft suffix in published UI.
export function policyVersionLabel(name: string, status: string) {
    return status === 'published' ? name.replace(/\s*\((?:Review\s+)?Draft\)\s*$/i, '') : name;
}
