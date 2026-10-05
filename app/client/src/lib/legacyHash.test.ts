import { describe, expect, it } from 'vitest';
import { migrateLegacyHash } from './legacyHash';

/**
 * Runs the migration for a URL and reports the path it rewrote to, or nothing
 * when it left the URL alone.
 */
function rewritesTo(pathname: string, hash: string): string[] {
    const replaced: string[] = [];
    migrateLegacyHash({ pathname, hash }, (url) => replaced.push(url));
    return replaced;
}

describe('migrateLegacyHash', () => {
    it('sends an old app bookmark to its new path', () => {
        const replaced = rewritesTo('/', '#hr/staff');
        // `hr` is the internal id; `/leave` is what people now see.
        expect(replaced).toEqual(['/leave/staff']);
    });

    it('sends an app with no section to the app itself', () => {
        const replaced = rewritesTo('/', '#aba');
        expect(replaced).toEqual(['/aba']);
    });

    // The id stays `public-health` (it is baked into capabilities and table
    // names); only what people see was renamed to Fit for Duty.
    it('maps an app whose path differs from its id', () => {
        const replaced = rewritesTo('/', '#public-health/participants');
        expect(replaced).toEqual(['/fit-for-duty/participants']);
    });

    // A reset link arrives from an email and is read from the hash by App.
    // Rewriting it would throw the token away and strand the user.
    it('leaves a password reset link alone', () => {
        const replaced = rewritesTo('/', '#reset-password=abc123');
        expect(replaced).toEqual([]);
    });

    // Apps not yet converted still drive their own tabs through the hash.
    // Rewriting from inside one would fight them for the URL.
    it('does nothing once the user is already inside an app', () => {
        const replaced = rewritesTo('/aba', '#aba/generator');
        expect(replaced).toEqual([]);
    });

    it('ignores an empty or unrecognised hash', () => {
        expect(rewritesTo('/', '')).toEqual([]);
        expect(rewritesTo('/', '#not-an-app/somewhere')).toEqual([]);
    });
});
