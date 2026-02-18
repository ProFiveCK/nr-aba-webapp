# GitHub Push Preparation

This repo is intended to be safe to push to GitHub (public or private) **as long as you do not commit secrets or production data**.

## Pre-push checklist

1) Run the automated check:

```bash
./check-security.sh
```

2) Verify that secret/data files are NOT tracked:

- `.env`, `.env.prod`, and any `app/**/.env*`
- `archive/` and `**/*.sql`
- any backup archives like `*.tar.gz`

3) Sanity check what will be pushed:

```bash
git status
git diff
```

## What should never go to GitHub

- Real credentials (DB passwords, SMTP passwords, API tokens)
- Database dumps (`*.sql`) or production snapshots
- Anything under `archive/` (production backups)

The `.gitignore` is configured to exclude these by default.

## First push steps

```bash
git add .
git commit -m "Docs + deployment updates"
git branch -M main
git remote add origin https://github.com/YOUR-ORG/YOUR-REPO.git
git push -u origin main
```

## If a secret is committed accidentally

1) Rotate the secret immediately (DB password, SMTP password, token, etc.)
2) Remove it from the repo and rewrite history (don’t rely on “delete in latest commit”)
3) Force-push the rewritten history (coordinate with your team first)
