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

describe('Admin Session Auth', () => {
  it('redirects to /admin/login when no session cookie', async () => {
    const req = new Request('http://worker/admin');
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/admin/login');
  });

  it('returns login page for GET /admin/login', async () => {
    const req = new Request('http://worker/admin/login');
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('returns 401 for wrong password on POST /admin/login', async () => {
    const req = new Request('http://worker/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: 'wrongpass' }).toString(),
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(401);
  });

  it('sets session cookie and redirects for correct password', async () => {
    const req = new Request('http://worker/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: 'adminpass' }).toString(),
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/admin');
    expect(res.headers.get('Set-Cookie')).toContain('admin_sid=');
  });

  it('allows access with valid session cookie', async () => {
    const { makeSessionToken } = await import('../src/admin.js');
    const token = await makeSessionToken('adminpass');
    const req = new Request('http://worker/admin', {
      headers: { Cookie: `admin_sid=${token}` },
    });
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(200);
  });

  it('clears cookie and redirects on logout', async () => {
    const req = new Request('http://worker/admin/logout');
    const res = await worker.fetch(req, makeEnv(), {});
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/admin/login');
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
});
