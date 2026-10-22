import { Field, inputClass } from './ManagementFields';

export function MedicalCertificateField() {
    return <Field label="Medical leave certificate status"><select name="medical_mode" required defaultValue="" className={inputClass}>
        <option value="" disabled>Choose with MC or without MC</option>
        <option value="certificate">With a medical certificate</option>
        <option value="exemption">Without a medical certificate</option>
    </select></Field>;
}
