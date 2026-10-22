export function medicalCertificateLabel(mode?: string | null) {
    return mode === 'certificate' ? 'With MC · medical certificate' : mode === 'exemption' ? 'Without MC · uncertified absence' : 'MC status not recorded';
}
