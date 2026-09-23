/**
 * Centralised error handling.
 *
 * Express 4 does not forward a rejected promise from an async handler to the
 * error middleware — it is simply lost, and the request hangs until the client
 * times out with nothing in the log. Rather than wrapping several hundred
 * existing handlers by hand (and relying on every future one remembering),
 * `enableAsyncErrors()` patches the route-registration methods once so any
 * handler that returns a rejected promise, or throws synchronously, is routed
 * to `next(err)`.
 *
 * IMPORTANT: routers register their routes while their module is being
 * evaluated, so this patch has to be in place before any `routes/*.js` module
 * is imported. `server.js` therefore imports this module first, above the
 * router imports. Keep it that way, and keep this module free of project-local
 * imports so it cannot be pulled in transitively by something earlier.
 *
 * Express 5 forwards async rejections natively; once the app moves to it,
 * `enableAsyncErrors()` can be deleted and the rest of this file kept as is.
 */

import { randomUUID } from 'node:crypto';
import express from 'express';

// Registration methods that take middleware. `app.get` is dual-purpose and is
// special-cased below.
const ROUTE_METHODS = ['use', 'all', 'get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

/** Wraps one handler so a synchronous throw or a rejected promise reaches `next`. */
function wrapHandler(fn) {
  if (typeof fn !== 'function' || fn.__asyncWrapped) return fn;
  // A mounted Router or sub-app, not a handler — pass it through untouched.
  if (fn.stack || fn.lazyrouter) return fn;

  // Express decides a function is error middleware by its arity, so the two
  // shapes have to be preserved separately.
  const wrapped = fn.length === 4
    ? function (err, req, res, next) {
      let result;
      try {
        result = fn.call(this, err, req, res, next);
      } catch (thrown) {
        return next(thrown);
      }
      if (result && typeof result.then === 'function') result.then(undefined, next);
      return result;
    }
    : function (req, res, next) {
      let result;
      try {
        result = fn.call(this, req, res, next);
      } catch (thrown) {
        return next(thrown);
      }
      if (result && typeof result.then === 'function') result.then(undefined, next);
      return result;
    };

  // Keep the original name so stack traces stay readable.
  Object.defineProperty(wrapped, 'name', { value: fn.name, configurable: true });
  wrapped.__asyncWrapped = true;
  return wrapped;
}

/** Wraps every handler in a registration call, including arrays of middleware. */
function wrapArguments(args) {
  return args.map((arg) => (Array.isArray(arg) ? arg.map(wrapHandler) : wrapHandler(arg)));
}

function patchPrototype(proto) {
  for (const method of ROUTE_METHODS) {
    const original = proto[method];
    if (typeof original !== 'function' || original.__asyncPatched) continue;

    const patched = function (...args) {
      // `app.get('port')` reads a setting rather than registering a route.
      if (method === 'get' && args.length === 1) return original.call(this, args[0]);
      return original.apply(this, wrapArguments(args));
    };
    patched.__asyncPatched = true;
    proto[method] = patched;
  }
}

/**
 * Makes async handlers safe across the whole app. Idempotent, and safe to call
 * from a test. Patches the shared Router prototype (so every router, whenever
 * it was created, is covered) and the application prototype.
 */
export function enableAsyncErrors() {
  patchPrototype(Object.getPrototypeOf(express.Router()));
  patchPrototype(express.application);
}

/**
 * Postgres error codes worth translating into a meaningful status. Anything
 * not listed is treated as a server fault.
 */
const PG_ERRORS = {
  23505: { status: 409, message: 'That record already exists.' },
  23503: { status: 409, message: 'That record is still referenced by other data.' },
  23502: { status: 400, message: 'A required field was missing.' },
  23514: { status: 400, message: 'A value was not one of the permitted options.' },
  '22P02': { status: 400, message: 'A value was not in the expected format.' },
  22003: { status: 400, message: 'A number was out of range.' },
  22001: { status: 400, message: 'A value was too long for the field.' },
};

/** Body-parser failures arrive as tagged errors rather than status codes. */
const BODY_ERRORS = {
  'entity.parse.failed': { status: 400, message: 'The request body was not valid JSON.' },
  'entity.too.large': { status: 413, message: 'The request body was too large.' },
};

function classify(err) {
  const explicit = Number(err?.status || err?.statusCode);
  if (Number.isInteger(explicit) && explicit >= 400 && explicit <= 599) {
    return { status: explicit, message: err.message };
  }
  const byType = BODY_ERRORS[err?.type];
  if (byType) return byType;
  const byCode = PG_ERRORS[err?.code];
  if (byCode) return byCode;
  return { status: 500, message: null };
}

/**
 * The single place an unhandled failure becomes a response. Every error gets a
 * short reference that appears both in the log and in the response, so a user
 * reporting "it failed" can be matched to a specific stack trace. Server faults
 * never leak their message to the client.
 */
export function errorHandler(err, req, res, next) {
  const { status, message } = classify(err);
  const reference = randomUUID().slice(0, 8);

  const context = `${req.method} ${req.originalUrl} [${reference}]`;
  if (status >= 500) {
    console.error(`Unhandled error: ${context}`, err);
  } else {
    console.warn(`Request rejected: ${context} — ${status} ${message}`);
  }

  // The response was already started, so the only correct move is to let
  // Express abort the connection.
  if (res.headersSent) {
    next(err);
    return;
  }

  res.status(status).json({
    message: status >= 500 ? 'An unexpected error occurred. Please try again.' : message,
    reference,
  });
}

/** Unmatched API routes should answer JSON, not Express's default HTML page. */
export function notFoundHandler(req, res, next) {
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }
  res.status(404).json({ message: `No such endpoint: ${req.method} ${req.path}` });
}

/**
 * Last-resort guards. A rejection that never reached a request is logged and
 * the process continues; an uncaught exception leaves the process in an
 * undefined state, so it is logged and the container is allowed to restart
 * (compose sets `restart: unless-stopped`).
 */
export function installProcessGuards() {
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception — exiting so the container restarts', err);
    process.exit(1);
  });
}
