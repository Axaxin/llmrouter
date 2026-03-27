// test/config.test.js
import { describe, it, expect } from 'vitest';
import { getConfig, setConfig, getAccessToken, setAccessToken, getAdminPassword } from '../src/config.js';

function makeKV(initial = {}) {
  const store = { ...initial };
  return {
    get: async (key) => store[key] ?? null,
    put: async (key, value) => { store[key] = value; },
  };
}

describe('getConfig', () => {
  it('returns empty object when KV has no config', async () => {
    const env = { KV: makeKV() };
    expect(await getConfig(env)).toEqual({});
  });
  it('returns parsed config from KV', async () => {
    const config = { tx: { name: 'Tencent', models: {} } };
    const env = { KV: makeKV({ 'config:platforms': JSON.stringify(config) }) };
    expect(await getConfig(env)).toEqual(config);
  });
});

describe('setConfig', () => {
  it('writes JSON-stringified config to KV', async () => {
    const kv = makeKV();
    const env = { KV: kv };
    const config = { tx: { name: 'Tencent' } };
    await setConfig(env, config);
    expect(await kv.get('config:platforms')).toBe(JSON.stringify(config));
  });
});

describe('getAccessToken', () => {
  it('returns token from KV', async () => {
    const env = { KV: makeKV({ 'auth:access_token': 'sk-abc123' }) };
    expect(await getAccessToken(env)).toBe('sk-abc123');
  });
  it('returns null when not set', async () => {
    const env = { KV: makeKV() };
    expect(await getAccessToken(env)).toBeNull();
  });
});

describe('setAccessToken', () => {
  it('writes token to KV', async () => {
    const kv = makeKV();
    const env = { KV: kv };
    await setAccessToken(env, 'new-token');
    expect(await kv.get('auth:access_token')).toBe('new-token');
  });
});

describe('getAdminPassword', () => {
  it('returns ADMIN_PASSWORD env var', () => {
    const env = { KV: makeKV(), ADMIN_PASSWORD: 'secret123' };
    expect(getAdminPassword(env)).toBe('secret123');
  });
  it('returns empty string when not set', () => {
    const env = { KV: makeKV() };
    expect(getAdminPassword(env)).toBe('');
  });
});
