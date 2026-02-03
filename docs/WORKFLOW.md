# ABA Stack Git Workflow

## Branching model
- **main** = production (only deploy from here)
- **develop** = integration (default branch for daily work/testing)
- **feature/*** = short‑lived branches for changes
- **hotfix/*** = urgent fixes based on main

## Versioning (recommended)
Use **SemVer**: `MAJOR.MINOR.PATCH`
- **MAJOR**: breaking changes or migrations that require manual steps
- **MINOR**: new features, backward compatible
- **PATCH**: fixes, no breaking changes

Tag production releases on **main**:
- Example: `v1.4.2`
- Each production deployment should have a tag

## Suggested workflow
1. Start work from **develop**
2. Create a feature branch: `feature/<short-name>`
3. Merge back into **develop** after testing
4. When ready for production:
   - Merge **develop** into **main**
   - Tag the release (e.g., `v1.4.2`)
   - Deploy from **main**

## Production migration steps (high level)
1. Confirm backups exist (DB + app data)
2. Review **PRODUCTION-DEPLOYMENT-CHECKLIST.md**
3. Review **PRODUCTION-MIGRATION-GUIDE.md** for schema/data changes
4. Deploy the **main** branch tag
5. Validate smoke tests and critical flows

## Notes
- Never commit `.env*` or SQL dumps.
- Keep `archive/` excluded from Git.
- Consider release notes in the tag description for tracking what changed.
