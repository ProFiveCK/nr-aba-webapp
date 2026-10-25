# VibeSec Security Scan Report

**Scan date:** 2026-08-04
**Codebase:** `aba-stack` (production) @ commit `593aa06`
**Scanner:** [VibeSec-Skill](https://github.com/BehiSecc/VibeSec-Skill) v1.0.0
**Environment:** Ubuntu 22.04, Docker Compose, Cloudflare CDN

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 2 | 1 fixed (HSTS), 1 fixed (httpOnly cookies) |
| Low | 3 | Acceptable or minor improvements |

All 12 original VibeSec critical/high findings from the initial scan have been fixed and verified in production.

---

## Passing Categories (14)

### 1. JWT Security — PASS
- `algorithms: ['HS256']` enforced on `jwt.verify` (server.js:1457)
- `exp` claim set via `expiresIn`
- 96-char cryptographically random secret from env (`JWT_SECRET`)

### 2. XSS (Client-Side) — PASS
- `escapeHtml()` applied before markdown replacements in `AiHelper.tsx:23`
- `utils.ts:323` uses safe `textContent` method for HTML escaping
- CSP `scriptSrc` is `'self'` only — no `'unsafe-inline'` for scripts

### 3. CSRF — PASS
- `csrfGuard` rejects cross-origin state-changing requests (server.js:190)
- All state-changing endpoints behind `requireAuth()`

### 4. SSRF — PASS
- `safeFetchSyncUrl()` validates host before `fetch()`
- `isBlockedHost()` blocks RFC1918, loopback, link-local, cloud metadata IPs
- `SYNC_ALLOWED_HOSTS` configured in production

### 5. File Upload — PASS
- Extension allowlist: `.xlsx` and `.xls` only
- Magic byte validation: ZIP and OLE2 signatures checked
- 10MB size limit
- `sanitizePayrollFileName` uses `path.basename()` (path traversal prevention)

### 6. SQL Injection — PASS
- All queries use parameterized placeholders
- No string concatenation in SQL
- Search uses parameterized `LIKE` wildcards

### 7. Path Traversal — PASS
- `sanitizePayrollFileName` strips directory components
- Temp files in `os.tmpdir()` with `mkdtemp` random prefix

### 8. Mass Assignment — PASS
- 4 PUT handlers use explicit `allowedFields` allowlists

### 9. Password Security — PASS
- `bcrypt.hash` with 12 rounds
- No MD5, SHA1, or unsalted SHA256 for passwords

### 10. SMTP Encryption — PASS
- AES-256-GCM via `SMTP_ENC_KEY`
- Decrypt fails closed

### 11. Secret Exposure — PASS
- No secrets in client code
- `.env.prod` gitignored

### 12. Open Redirect — PASS
- No `res.redirect()` with user input

### 13. Security Headers — PASS
- Helmet with CSP, X-Content-Type-Options, frame-ancestors, base-uri, form-action
- HSTS added to helmet (defense-in-depth)

### 14. Access Control — PASS
- All data endpoints behind `requireAuth()` with role checks
- No IDOR vulnerabilities

---

## Medium Findings (2) — Both Fixed

### M1: JWT token stored in localStorage — FIXED
Moved to httpOnly Secure SameSite=Strict cookies set by backend.

### M2: No HSTS header in backend — FIXED
Added strictTransportSecurity to helmet config (Cloudflare also sets it).

---

## Low / Informational (3)

### L1: /api/department-profiles/active is unauthenticated
Acceptable — non-sensitive metadata for signup dropdowns.

### L2: styleSrc allows unsafe-inline
Acceptable — Tailwind CSS requires inline styles.

### L3: Legacy SHA-256 passphrase path exists
Migration-only verification. No upgrade-on-verify hook yet.
