// test/index.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/index.js';

function makeEnv(overrides = {}) {
  const store = {
    'auth:access_token': 'valid-token',
    'config:platforms': null,
  };
  return {
    KV: {
      get: async (key) => store[key] ?? null,
      put: async (key, value) => { store[key] = value; },
    },
    ADMIN_PASSWORD: 'adminpass',
    ...overrides,
  };
}

describe('CORS', () => {
  it('OPTIONS returns 204 with CORS headers', async () => {
    const req = new Request('http://worker/v1/chat/completions', { method: 'OPTIONS' });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('all responses include CORS headers', async () => {
    const req = new Request('http://worker/health');
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('/health', () => {
  it('returns ok without auth', async () => {
    const req = new Request('http://worker/health');
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('Bearer token auth', () => {
  it('returns 401 when no token', async () => {
    const req = new Request('http://worker/v1/models');
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(401);
  });

  it('returns 401 for wrong token', async () => {
    const req = new Request('http://worker/v1/models', {
      headers: { Authorization: 'Bearer wrong' },
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(401);
  });

  it('allows request with correct token', async () => {
    const req = new Request('http://worker/v1/models', {
      headers: { Authorization: 'Bearer valid-token' },
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(200);
  });
});

describe('Admin Basic Auth', () => {
  it('returns 401 with WWW-Authenticate when no credentials', async () => {
    const req = new Request('http://worker/admin');
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Basic');
  });

  it('returns 401 for wrong password', async () => {
    const creds = btoa('user:wrongpass');
    const req = new Request('http://worker/admin', {
      headers: { Authorization: `Basic ${creds}` },
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(401);
  });

  it('allows access with correct password', async () => {
    const creds = btoa('user:adminpass');
    const req = new Request('http://worker/admin', {
      headers: { Authorization: `Basic ${creds}` },
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(200);
  });
});
