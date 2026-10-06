import express from 'express';
import cors from 'cors';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import { pool, initSchema } from './db.js';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { runDueLeaveAccruals } from './services/leaveAccrual.js';
import { LOCK_KEYS, withAdvisoryLock } from './lib/advisoryLock.js';
import { buildCookieParser, csrfGuard } from './services/authService.js';
import { lowerEmail } from './utils/helpers.js';
import {
  enableAsyncErrors,
  errorHandler,
  installProcessGuards,
  notFoundHandler,
} from './middleware/errors.js';
import { refreshTestingModeSetting, reloadMailTransport } from './services/mailService.js';
import {
  FRONTEND_BASE_URL,
  PASS_HASH_ROUNDS,
  PASSWORD_MIN_LENGTH,
} from './config.js';

dotenv.config();

// The in-process accrual scheduler, on unless a deployment drives it from cron.
const ACCRUAL_SCHEDULER_ENABLED = (process.env.ACCRUAL_SCHEDULER || 'on').toLowerCase() !== 'off';

// Express 4 drops a rejected promise from an async handler on the floor: the
// request hangs and nothing is logged. `enableAsyncErrors()` routes those to
// the error handler at the bottom of the middleware stack instead.
//
// It works by patching the route-registration methods, so it has to run before
// any route is registered. The routes in this file are registered further down,
// but a router registers its own while its module is evaluated — which for a
// static `import` is before this line. The routers are therefore loaded
// here, after the patch. Add new routers to this block, not to the imports
// above.
enableAsyncErrors();
installProcessGuards();

const [
  { default: forexTTRouter },
  { default: healthRouter },
  { default: publicHealthRouter },
  { default: hrRouter },
  { default: authRouter },
  { default: adminRouter },
  { default: payrollRouter },
  { default: listsRouter },
  { default: batchesRouter },
  { default: syncRouter },
  { default: aiHelperRouter },
] = await Promise.all([
  import('./routes/forexTT.js'),
  import('./routes/health.js'),
  import('./routes/public-health.js'),
  import('./routes/hr.js'),
  import('./routes/auth.js'),
  import('./routes/admin.js'),
  import('./routes/payroll.js'),
  import('./routes/lists.js'),
  import('./routes/batches.js'),
  import('./routes/sync.js'),
  import('./routes/aiHelper.js'),
]);
const app = express();

// Trust the nginx reverse proxy so X-Forwarded-For is used safely by express-rate-limit
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
}));

// CORS: restrict to configured frontend origin
const corsOrigin = FRONTEND_BASE_URL;
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(buildCookieParser());

// Allow larger payloads for ABA uploads (base64 inflates size by ~33%)
app.use(express.json({ limit: '10mb' }));
app.use(csrfGuard(corsOrigin));

// Rate limiting: general API
// Skip /api/auth/* so authentication endpoints are governed only by the
// per-account authLimiter. This prevents a busy shared office IP from
// blocking staff login/signon/password-reset requests.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' },
  // HR endpoints enforce an authenticated account budget in requirePermission.
  skip: (req) => req.path.startsWith('/auth/') || req.path === '/hr' || req.path.startsWith('/hr/'),
});
app.use('/api', generalLimiter);

// Rate limiting: authentication endpoints, twice over.
// Per account: a brute-force attempt on one account cannot lock out everyone
// behind the same office gateway. Per address: one address cannot spray a
// common password across many accounts, which the per-account limit never
// sees. The address limit is generous because staff share a NAT.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: true,
  message: { message: 'Too many authentication attempts for this account. Please try again later.' },
  skipSuccessfulRequests: true, // successful logins reset the in-memory attempt budget
  keyGenerator: (req) => {
    const email = req.body?.login_alias ? `payroll:${String(req.body.login_alias).trim()}` : String(req.body?.email || '').toLowerCase().trim();
    return email ? `email:${email}` : `ip:${ipKeyGenerator(req.ip)}`;
  },
});
const authIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many sign-in attempts from your network. Please try again later.' },
  skipSuccessfulRequests: true,
});
for (const route of ['login', 'google', 'signup', 'forgot-password', 'reset-password', 'activate-leave']) {
  app.use(`/api/auth/${route}`, authIpLimiter, authLimiter);
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.use('/api/forex-tt', forexTTRouter);
app.use('/api/public-health', publicHealthRouter);
app.use('/api/hr', hrRouter);
app.use('/api', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api', adminRouter);
app.use('/api/payroll', payrollRouter);
app.use('/api', listsRouter);
app.use('/api', batchesRouter);
app.use('/api', syncRouter);
app.use('/api/ai-helper', aiHelperRouter);

// Creates the first administrator on a fresh install, from DEFAULT_ADMIN_*.
// Only while there is no active administrator at all, so deleting or renaming
// the account later never brings it back, and never with a guessable password.
async function bootstrapDefaultAdmin() {
  const email = lowerEmail(process.env.DEFAULT_ADMIN_EMAIL);
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  if (!email || !password) return;

  const { rows: admins } = await pool.query(
    "SELECT 1 FROM reviewers WHERE role = 'admin' AND status = 'active' LIMIT 1"
  );
  if (admins.length) return;

  const weak = ['change_me_on_first_login', 'Admin123!'].includes(password) || password.length < PASSWORD_MIN_LENGTH;
  if (weak) {
    console.error(`No administrator exists, and DEFAULT_ADMIN_PASSWORD is a known default or shorter than ${PASSWORD_MIN_LENGTH} characters, so none was created. Set a strong one in .env.prod and restart.`);
    return;
  }

  const displayName = process.env.DEFAULT_ADMIN_NAME || 'Admin';
  const hash = await bcrypt.hash(password, PASS_HASH_ROUNDS);
  await pool.query(
    `INSERT INTO reviewers (email, display_name, role, status, password_hash, must_change_password, department_code, notify_on_submission)
     VALUES ($1, $2, 'admin', 'active', $3, TRUE, NULL, FALSE)
     ON CONFLICT (email) DO UPDATE
       SET role = 'admin', status = 'active', password_hash = EXCLUDED.password_hash,
           must_change_password = TRUE, updated_at = NOW()`,
    [email, displayName, hash]
  );
  console.log(`No active administrator existed; set up ${email} as administrator. Sign in and change the password, then remove DEFAULT_ADMIN_PASSWORD from .env.prod.`);
}

const PORT = Number(process.env.PORT || 4000);

// ===== Error handling =====
// Mounted last so every route above has had its chance: an unmatched /api path
// answers JSON rather than Express's HTML page, and anything that threw or
// rejected lands in one place with a reference the user can quote.
app.use(notFoundHandler);
app.use(errorHandler);

initSchema()
  .then(async () => {
    try {
      await bootstrapDefaultAdmin();
    } catch (err) {
      console.error('Failed to bootstrap default admin', err);
    }
    try {
      await refreshTestingModeSetting();
    } catch (err) {
      console.error('Failed to initialize testing mode state', err);
    }
    // Override env-based mailTransport with DB settings if they exist.
    try {
      const smtpSettings = await reloadMailTransport();
      if (smtpSettings) {
        console.log(`SMTP transport loaded from DB: ${smtpSettings.smtp_host}:${smtpSettings.smtp_port}`);
      }
    } catch (err) {
      console.error('Failed to load SMTP settings from DB:', err.message);
    }
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`RON ABA backend listening on port ${PORT}`);
    });

    // Fortnightly leave accrual. Runs any due periods on startup (catching up
    // after downtime) and then checks hourly.
    //
    // The advisory lock means only one container does the work when the API is
    // scaled out — the rest decline quietly rather than racing and failing on
    // the period_end constraint. Set ACCRUAL_SCHEDULER=off to run it from cron
    // instead (`npm run accrual -- --due`); the two are interchangeable and
    // equally idempotent.
    if (ACCRUAL_SCHEDULER_ENABLED) {
      const runScheduledAccruals = async () => {
        try {
          const { acquired, result } = await withAdvisoryLock(
            pool, LOCK_KEYS.LEAVE_ACCRUAL, () => runDueLeaveAccruals(pool)
          );
          if (!acquired) return;
          for (const periodEnd of result.ran) {
            console.log(`[accrual-scheduler] Ran leave accrual for period ending ${periodEnd}`);
          }
        } catch (err) {
          console.error('[accrual-scheduler] Failed to run due leave accruals', err);
        }
      };
      runScheduledAccruals();
      setInterval(runScheduledAccruals, 60 * 60 * 1000).unref();
    } else {
      console.log('[accrual-scheduler] Disabled (ACCRUAL_SCHEDULER=off) - run it from cron.');
    }
  })
  .catch((err) => {
    console.error('Failed to start server', err);
    process.exit(1);
  });
