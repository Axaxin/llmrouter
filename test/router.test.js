// test/router.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleForwardRequest, handleListModels, handleHealthCheck } from '../src/router.js';

function makeKV(platforms = null, token = 'valid-token') {
  const store = {
    'config:platforms': platforms ? JSON.stringify(platforms) : null,
    'auth:access_token': token,
  };
  return {
    get: async (key) => store[key] ?? null,
    put: async (key, value) => { store[key] = value; },
  };
}

const PLATFORMS = {
  tx: {
    name: 'Tencent',
    baseUrls: { openai: 'https://api.tencentcloudbase.com' },
    apiKey: 'tx-key-123',
    models: { 'glm-5': { internalName: 'glm-5' } },
  },
  jd: {
    name: 'JD Cloud',
    baseUrls: { openai: 'https://api.jd.com/v1' },
    apiKey: 'jd-key-456',
    models: { 'qwen-14b': { internalName: 'qwen-14b-chat' } },
  },
};

describe('handleHealthCheck', () => {
  it('returns status ok', async () => {
    const res = handleHealthCheck();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('handleListModels', () => {
  it('returns model list from KV', async () => {
    const env = { KV: makeKV(PLATFORMS) };
    const res = await handleListModels(env);
    const body = await res.json();
    expect(body.object).toBe('list');
    const ids = body.data.map(m => m.id);
    expect(ids).toContain('tx/glm-5');
    expect(ids).toContain('jd/qwen-14b');
  });
  it('returns empty list when no config', async () => {
    const env = { KV: makeKV() };
    const res = await handleListModels(env);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});

describe('handleForwardRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('forwards request to correct upstream URL', async () => {
    const upstreamResponse = new Response('{"id":"chatcmpl-1"}', { status: 200 });
    vi.mocked(fetch).mockResolvedValue(upstreamResponse);

    const env = { KV: makeKV(PLATFORMS) };
    const req = new Request('http://worker/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tx/glm-5', messages: [{ role: 'user', content: 'hi' }] }),
    });

    const res = await handleForwardRequest(req, env);
    expect(res.status).toBe(200);

    const [calledUrl, calledInit] = vi.mocked(fetch).mock.calls[0];
    expect(calledUrl).toBe('https://api.tencentcloudbase.com/v1/chat/completions');
    const body = JSON.parse(calledInit.body);
    expect(body.model).toBe('glm-5');
    expect(calledInit.headers.get('Authorization')).toBe('Bearer tx-key-123');
  });

  it('maps internalName correctly', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }));
    const env = { KV: makeKV(PLATFORMS) };
    const req = new Request('http://worker/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'jd/qwen-14b', messages: [] }),
    });

    await handleForwardRequest(req, env);
    const [, calledInit] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(calledInit.body).model).toBe('qwen-14b-chat');
  });

  it('sets anthropic headers for anthropic protocol', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }));
    const platforms = {
      tx: {
        ...PLATFORMS.tx,
        baseUrls: { ...PLATFORMS.tx.baseUrls, anthropic: 'https://api.tencentcloudbase.com/anthropic' },
      },
    };
    const env = { KV: makeKV(platforms) };
    const req = new Request('http://worker/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tx/glm-5', messages: [] }),
    });

    await handleForwardRequest(req, env);
    const [, calledInit] = vi.mocked(fetch).mock.calls[0];
    expect(calledInit.headers.get('x-api-key')).toBe('tx-key-123');
    expect(calledInit.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(calledInit.headers.get('Authorization')).toBeNull();
  });

  it('returns 400 for unknown platform', async () => {
    const env = { KV: makeKV(PLATFORMS) };
    const req = new Request('http://worker/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'unknown/model', messages: [] }),
    });

    const res = await handleForwardRequest(req, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('unknown');
  });

  it('returns 400 for unknown model', async () => {
    const env = { KV: makeKV(PLATFORMS) };
    const req = new Request('http://worker/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tx/nonexistent', messages: [] }),
    });

    const res = await handleForwardRequest(req, env);
    expect(res.status).toBe(400);
  });

  it('returns 500 when no config in KV', async () => {
    const env = { KV: makeKV() };
    const req = new Request('http://worker/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tx/glm-5', messages: [] }),
    });

    const res = await handleForwardRequest(req, env);
    expect(res.status).toBe(500);
  });
});
