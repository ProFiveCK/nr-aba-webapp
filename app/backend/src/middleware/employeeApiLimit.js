import rateLimit from 'express-rate-limit';

// Applied only after authentication: staff behind a shared government gateway
// each receive their own budget, without trusting a client-supplied ID or JWT.
export function createEmployeeApiLimiter(limit = 300) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    keyGenerator: (req) => req.user.id,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests for this account. Please try again later.' },
  });
}

export const employeeApiLimiter = createEmployeeApiLimiter();
