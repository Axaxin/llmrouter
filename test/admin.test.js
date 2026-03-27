// test/admin.test.js
import { describe, it, expect } from 'vitest';
import { handleAdmin } from '../src/admin.js';

function makeKV(initial = {}) {
  const store = { ...initial };
  return {
    get: async (key) => store[key] ?? null,
    put: async (key, value) => { store[key] = value; },
  };
}

const PLATFORMS = {
  tx: { name: 'Tencent', baseUrls: { openai: 'https://api.tc.com' }, apiKey: 'key-abcdef', models: {} },
};

describe('GET /admin', () => {
  it('returns HTML page', async () => {
    const env = { KV: makeKV() };
    const req = new Request('http://worker/admin');
    const res = await handleAdmin(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('LLMBridge');
  });
});

describe('GET /admin/api/config', () => {
  it('returns config with masked API keys', async () => {
    const env = { KV: makeKV({ 'config:platforms': JSON.stringify(PLATFORMS) }) };
    const req = new Request('http://worker/admin/api/config');
    const res = await handleAdmin(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tx.apiKey).toMatch(/^\*+/);
    expect(body.tx.apiKey).not.toBe('key-abcdef');
    expect(body.tx.name).toBe('Tencent');
  });
  it('returns empty object when no config', async () => {
    const env = { KV: makeKV() };
    const req = new Request('http://worker/admin/api/config');
    const res = await handleAdmin(req, env);
    expect(await res.json()).toEqual({});
  });
});

describe('PUT /admin/api/config', () => {
  it('saves config to KV', async () => {
    const kv = makeKV();
    const env = { KV: kv };
    const newConfig = { tx: { name: 'Tencent', apiKey: 'newkey', models: {} } };
    const req = new Request('http://worker/admin/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig),
    });
    const res = await handleAdmin(req, env);
    expect(res.status).toBe(200);
    expect(await kv.get('config:platforms')).toBe(JSON.stringify(newConfig));
  });

  it('preserves existing apiKey when masked value sent', async () => {
    const original = { tx: { name: 'Tencent', apiKey: 'real-key-xyz', models: {} } };
    const kv = makeKV({ 'config:platforms': JSON.stringify(original) });
    const env = { KV: kv };
    const update = { tx: { name: 'Tencent Updated', apiKey: '***xyz', models: {} } };
    const req = new Request('http://worker/admin/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    await handleAdmin(req, env);
    const saved = JSON.parse(await kv.get('config:platforms'));
    expect(saved.tx.apiKey).toBe('real-key-xyz');
    expect(saved.tx.name).toBe('Tencent Updated');
  });
});

describe('PUT /admin/api/token', () => {
  it('saves new access token to KV', async () => {
    const kv = makeKV();
    const env = { KV: kv };
    const req = new Request('http://worker/admin/api/token', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'new-access-token' }),
    });
    const res = await handleAdmin(req, env);
    expect(res.status).toBe(200);
    expect(await kv.get('auth:access_token')).toBe('new-access-token');
  });
});

describe('unknown /admin/api/* route', () => {
  it('returns 404', async () => {
    const env = { KV: makeKV() };
    const req = new Request('http://worker/admin/api/unknown');
    const res = await handleAdmin(req, env);
    expect(res.status).toBe(404);
  });
});
