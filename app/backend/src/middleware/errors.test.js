/**
 * Covers the async-error patch and the error handler. The patch reaches into
 * how Express registers routes, so it is worth asserting directly rather than
 * discovering a regression through a hung request in production.
 *
 * Run with `npm test` (node --test). No database is needed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {
  enableAsyncErrors,
  errorHandler,
  notFoundHandler,
} from './errors.js';

enableAsyncErrors();

/** Boots an app on an ephemeral port and returns a fetch bound to it. */
async function serve(build) {
  const app = express();
  app.use(express.json());
  build(app);
  app.use(notFoundHandler);
  app.use(errorHandler);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  const call = (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init);
  return { call, close: () => new Promise((r) => server.close(r)) };
}

test('a rejected promise from an app route becomes a 500 with a reference', async () => {
  const { call, close } = await serve((app) => {
    app.get('/api/boom', async () => {
      throw new Error('database is on fire');
    });
  });
  try {
    const res = await call('/api/boom');
    const body = await res.json();
    assert.equal(res.status, 500);
    // The internal message must not reach the client.
    assert.equal(body.message, 'An unexpected error occurred. Please try again.');
    assert.match(body.reference, /^[0-9a-f]{8}$/);
  } finally {
    await close();
  }
});

test('a rejected promise from a router route is caught too', async () => {
  const router = express.Router();
  router.get('/fail', async () => {
    throw new Error('nope');
  });
  const { call, close } = await serve((app) => app.use('/api/thing', router));
  try {
    assert.equal((await call('/api/thing/fail')).status, 500);
  } finally {
    await close();
  }
});

test('a synchronous throw is caught as well', async () => {
  const { call, close } = await serve((app) => {
    app.get('/api/sync', () => {
      throw new Error('sync failure');
    });
  });
  try {
    assert.equal((await call('/api/sync')).status, 500);
  } finally {
    await close();
  }
});

test('every handler in an array of middleware is wrapped', async () => {
  const { call, close } = await serve((app) => {
    app.get('/api/chain', [
      (_req, _res, next) => next(),
      async () => {
        throw new Error('late failure');
      },
    ]);
  });
  try {
    assert.equal((await call('/api/chain')).status, 500);
  } finally {
    await close();
  }
});

test('an error carrying a status keeps it, and keeps its message', async () => {
  const { call, close } = await serve((app) => {
    app.get('/api/denied', async () => {
      const err = new Error('You may not do that.');
      err.status = 403;
      throw err;
    });
  });
  try {
    const res = await call('/api/denied');
    assert.equal(res.status, 403);
    assert.equal((await res.json()).message, 'You may not do that.');
  } finally {
    await close();
  }
});

test('a Postgres unique violation becomes a 409', async () => {
  const { call, close } = await serve((app) => {
    app.get('/api/dupe', async () => {
      const err = new Error('duplicate key value violates unique constraint');
      err.code = '23505';
      throw err;
    });
  });
  try {
    const res = await call('/api/dupe');
    assert.equal(res.status, 409);
    assert.equal((await res.json()).message, 'That record already exists.');
  } finally {
    await close();
  }
});

test('malformed JSON becomes a 400 rather than a hang', async () => {
  const { call, close } = await serve((app) => {
    app.post('/api/echo', (req, res) => res.json(req.body));
  });
  try {
    const res = await call('/api/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test('an unmatched API path answers JSON, not HTML', async () => {
  const { call, close } = await serve((app) => {
    app.get('/api/real', (_req, res) => res.json({ ok: true }));
  });
  try {
    const res = await call('/api/imaginary');
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.match((await res.json()).message, /No such endpoint/);
  } finally {
    await close();
  }
});

test('a successful route is unaffected by the patch', async () => {
  const { call, close } = await serve((app) => {
    app.get('/api/fine', async (_req, res) => res.json({ ok: true }));
  });
  try {
    const res = await call('/api/fine');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    await close();
  }
});

test('app.get() still reads settings rather than registering a route', () => {
  const app = express();
  app.set('trust proxy', 7);
  assert.equal(app.get('trust proxy'), 7);
});

test('enableAsyncErrors is idempotent', async () => {
  enableAsyncErrors();
  enableAsyncErrors();
  const { call, close } = await serve((app) => {
    app.get('/api/twice', async () => {
      throw new Error('still caught');
    });
  });
  try {
    assert.equal((await call('/api/twice')).status, 500);
  } finally {
    await close();
  }
});
