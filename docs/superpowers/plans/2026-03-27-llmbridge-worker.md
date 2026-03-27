# LLMBridge Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个 Cloudflare Worker，通过单一端点聚合腾讯云、京东云等多个 LLM 平台，配置通过 Web 面板管理。

**Architecture:** Worker 入口做认证分流（Bearer Token 验证 API 请求，Basic Auth 保护管理面板），路由层解析模型标签并从 KV 读取平台配置，转发请求到上游并代理响应（含流式）。管理面板是内嵌在 admin.js 中的纯 HTML 单页应用，通过 /admin/api/* 增删改平台和模型配置。

**Tech Stack:** Cloudflare Workers（无框架，纯 Web API），Cloudflare KV，Vitest（单测）

**一个设计调整（相对 design.md）：**
`ACCESS_TOKEN` 存储在 KV（key: `auth:access_token`）而非环境变量，这样可以通过管理面板修改。`ADMIN_PASSWORD` 仍为环境变量，通过 CF 控制台修改。

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `package.json` | 项目配置，vitest 脚本 |
| `wrangler.toml` | Worker 配置，KV binding |
| `src/errors.js` | 所有错误类，统一 toResponse() 方法 |
| `src/utils.js` | parseModelTag, parseRequestPath, generateModelList, verifyBearerToken, verifyBasicAuth |
| `src/config.js` | KV 读写封装：getConfig/setConfig/getAccessToken/setAccessToken/getAdminPassword |
| `src/router.js` | handleRequest, handleForwardRequest, handleListModels, handleHealthCheck |
| `src/admin.js` | 管理面板 HTML + /admin/api/* 接口 |
| `src/index.js` | Worker 入口，CORS，认证分流 |
| `test/errors.test.js` | errors.js 单测 |
| `test/utils.test.js` | utils.js 单测 |
| `test/config.test.js` | config.js 单测 |
| `test/router.test.js` | router.js 单测 |
| `test/admin.test.js` | admin.js 单测 |
| `test/index.test.js` | index.js 集成测试 |

---

## Task 1: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `wrangler.toml`
- Create: `vitest.config.js`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "llmbridge-worker",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "deploy:prod": "wrangler deploy --env production",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "wrangler": "^3.0.0",
    "vitest": "^1.0.0"
  }
}
```

- [ ] **Step 2: 创建 wrangler.toml**

```toml
name = "llmbridge-worker"
main = "src/index.js"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "KV"
id = "your_kv_namespace_id"    # 从 Cloudflare 控制台复制

[env.production]
route = "llmbridge.cc/*"
zone_id = "your_zone_id"
```

- [ ] **Step 3: 创建 vitest.config.js**

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: 安装依赖**

```bash
npm install
```

Expected: `node_modules/` 目录生成，无报错。

- [ ] **Step 5: 创建 src/ 和 test/ 目录占位**

```bash
mkdir -p src test
touch src/.gitkeep test/.gitkeep
```

- [ ] **Step 6: Commit**

```bash
git add package.json wrangler.toml vitest.config.js src/.gitkeep test/.gitkeep
git commit -m "chore: project scaffolding"
```

---

## Task 2: errors.js

**Files:**
- Create: `src/errors.js`
- Create: `test/errors.test.js`

- [ ] **Step 1: 写测试**

```javascript
// test/errors.test.js
import { describe, it, expect } from 'vitest';
import {
  AggregatorError,
  InvalidModelError,
  PlatformNotFoundError,
  ModelNotFoundError,
  ApiKeyMissingError,
  InvalidPathError,
  UnauthorizedError,
  ConfigNotFoundError,
} from '../src/errors.js';

describe('AggregatorError', () => {
  it('toResponse returns correct status and body', async () => {
    const err = new AggregatorError('test error', 400, 'invalid_request_error');
    const res = err.toResponse();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: { message: 'test error', type: 'invalid_request_error' } });
  });
});

describe('InvalidModelError', () => {
  it('has status 400 and includes model in message', () => {
    const err = new InvalidModelError('badmodel');
    expect(err.status).toBe(400);
    expect(err.message).toContain('badmodel');
  });
});

describe('PlatformNotFoundError', () => {
  it('has status 400 and includes platform in message', () => {
    const err = new PlatformNotFoundError('xyz');
    expect(err.status).toBe(400);
    expect(err.message).toContain('xyz');
  });
});

describe('ModelNotFoundError', () => {
  it('has status 400 and includes model and platform', () => {
    const err = new ModelNotFoundError('gpt-4', 'tx');
    expect(err.status).toBe(400);
    expect(err.message).toContain('gpt-4');
    expect(err.message).toContain('tx');
  });
});

describe('ApiKeyMissingError', () => {
  it('has status 500', () => {
    const err = new ApiKeyMissingError('tx');
    expect(err.status).toBe(500);
  });
});

describe('InvalidPathError', () => {
  it('has status 400', () => {
    const err = new InvalidPathError('/bad');
    expect(err.status).toBe(400);
  });
});

describe('UnauthorizedError', () => {
  it('has status 401', () => {
    const err = new UnauthorizedError();
    expect(err.status).toBe(401);
  });
  it('toResponse returns WWW-Authenticate header for Basic realm', async () => {
    const err = new UnauthorizedError('admin');
    const res = err.toResponse('Basic');
    expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="LLMBridge Admin"');
  });
});

describe('ConfigNotFoundError', () => {
  it('has status 500', () => {
    const err = new ConfigNotFoundError();
    expect(err.status).toBe(500);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm test -- test/errors.test.js
```

Expected: FAIL，`Cannot find module '../src/errors.js'`

- [ ] **Step 3: 实现 errors.js**

```javascript
// src/errors.js
export class AggregatorError extends Error {
  constructor(message, status = 500, type = 'api_error') {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.type = type;
  }

  toResponse(authScheme = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.status === 401 && authScheme === 'Basic') {
      headers['WWW-Authenticate'] = 'Basic realm="LLMBridge Admin"';
    }
    return new Response(
      JSON.stringify({ error: { message: this.message, type: this.type } }),
      { status: this.status, headers }
    );
  }
}

export class InvalidModelError extends AggregatorError {
  constructor(model) {
    super(`Invalid model format: "${model}". Expected "<platform>/<model>"`, 400, 'invalid_request_error');
  }
}

export class PlatformNotFoundError extends AggregatorError {
  constructor(platform) {
    super(`Platform "${platform}" not found`, 400, 'invalid_request_error');
  }
}

export class ModelNotFoundError extends AggregatorError {
  constructor(model, platform) {
    super(`Model "${model}" not found on platform "${platform}"`, 400, 'invalid_request_error');
  }
}

export class ApiKeyMissingError extends AggregatorError {
  constructor(platform) {
    super(`API key not configured for platform "${platform}"`, 500, 'api_error');
  }
}

export class InvalidPathError extends AggregatorError {
  constructor(path) {
    super(`Invalid request path: "${path}"`, 400, 'invalid_request_error');
  }
}

export class UnauthorizedError extends AggregatorError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'authentication_error');
  }
}

export class ConfigNotFoundError extends AggregatorError {
  constructor() {
    super('Platform configuration not found. Please configure via /admin panel.', 500, 'api_error');
  }
}
```

- [ ] **Step 4: 运行测试，确认全部通过**

```bash
npm test -- test/errors.test.js
```

Expected: 8 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/errors.js test/errors.test.js
git commit -m "feat: error classes"
```

---

## Task 3: utils.js

**Files:**
- Create: `src/utils.js`
- Create: `test/utils.test.js`

- [ ] **Step 1: 写测试**

```javascript
// test/utils.test.js
import { describe, it, expect } from 'vitest';
import {
  parseModelTag,
  parseRequestPath,
  generateModelList,
  verifyBearerToken,
  verifyBasicAuth,
} from '../src/utils.js';

describe('parseModelTag', () => {
  it('parses valid tag', () => {
    expect(parseModelTag('tx/glm-5')).toEqual({ platform: 'tx', modelName: 'glm-5' });
  });
  it('parses tag with slash in model name', () => {
    expect(parseModelTag('jd/qwen-14b')).toEqual({ platform: 'jd', modelName: 'qwen-14b' });
  });
  it('throws InvalidModelError for missing slash', () => {
    expect(() => parseModelTag('nogood')).toThrow('Invalid model format');
  });
  it('throws InvalidModelError for empty string', () => {
    expect(() => parseModelTag('')).toThrow('Invalid model format');
  });
  it('throws InvalidModelError for slash at start', () => {
    expect(() => parseModelTag('/model')).toThrow('Invalid model format');
  });
  it('throws InvalidModelError for slash at end', () => {
    expect(() => parseModelTag('platform/')).toThrow('Invalid model format');
  });
});

describe('parseRequestPath', () => {
  it('parses /openai/v1/chat/completions', () => {
    expect(parseRequestPath('/openai/v1/chat/completions')).toEqual({
      protocol: 'openai',
      apiPath: '/v1/chat/completions',
    });
  });
  it('parses /anthropic/v1/messages', () => {
    expect(parseRequestPath('/anthropic/v1/messages')).toEqual({
      protocol: 'anthropic',
      apiPath: '/v1/messages',
    });
  });
  it('parses /v1/chat/completions as openai', () => {
    expect(parseRequestPath('/v1/chat/completions')).toEqual({
      protocol: 'openai',
      apiPath: '/v1/chat/completions',
    });
  });
  it('throws InvalidPathError for unknown path', () => {
    expect(() => parseRequestPath('/unknown/path')).toThrow('Invalid request path');
  });
});

describe('generateModelList', () => {
  it('returns OpenAI-format model list', () => {
    const platforms = {
      tx: { name: 'Tencent', models: { 'glm-5': {}, 'glm-4': {} } },
      jd: { name: 'JD Cloud', models: { 'qwen-14b': {} } },
    };
    const result = generateModelList(platforms);
    expect(result.object).toBe('list');
    expect(result.data).toHaveLength(3);
    const ids = result.data.map(m => m.id);
    expect(ids).toContain('tx/glm-5');
    expect(ids).toContain('tx/glm-4');
    expect(ids).toContain('jd/qwen-14b');
    expect(result.data[0]).toMatchObject({ object: 'model', owned_by: expect.any(String) });
  });
  it('returns empty list for empty platforms', () => {
    expect(generateModelList({})).toEqual({ object: 'list', data: [] });
  });
});

describe('verifyBearerToken', () => {
  it('returns true for matching token', () => {
    const req = new Request('http://x', { headers: { Authorization: 'Bearer mytoken' } });
    expect(verifyBearerToken(req, 'mytoken')).toBe(true);
  });
  it('returns false for wrong token', () => {
    const req = new Request('http://x', { headers: { Authorization: 'Bearer wrong' } });
    expect(verifyBearerToken(req, 'mytoken')).toBe(false);
  });
  it('returns false for missing header', () => {
    const req = new Request('http://x');
    expect(verifyBearerToken(req, 'mytoken')).toBe(false);
  });
});

describe('verifyBasicAuth', () => {
  it('returns true for matching password', () => {
    const creds = btoa('user:mypassword');
    const req = new Request('http://x', { headers: { Authorization: `Basic ${creds}` } });
    expect(verifyBasicAuth(req, 'mypassword')).toBe(true);
  });
  it('returns false for wrong password', () => {
    const creds = btoa('user:wrong');
    const req = new Request('http://x', { headers: { Authorization: `Basic ${creds}` } });
    expect(verifyBasicAuth(req, 'mypassword')).toBe(false);
  });
  it('returns false for missing header', () => {
    const req = new Request('http://x');
    expect(verifyBasicAuth(req, 'mypassword')).toBe(false);
  });
  it('handles password containing colon', () => {
    const creds = btoa('user:pass:with:colons');
    const req = new Request('http://x', { headers: { Authorization: `Basic ${creds}` } });
    expect(verifyBasicAuth(req, 'pass:with:colons')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm test -- test/utils.test.js
```

Expected: FAIL，`Cannot find module '../src/utils.js'`

- [ ] **Step 3: 实现 utils.js**

```javascript
// src/utils.js
import { InvalidModelError, InvalidPathError } from './errors.js';

export function parseModelTag(modelStr) {
  if (!modelStr || typeof modelStr !== 'string') throw new InvalidModelError(modelStr);
  const slashIndex = modelStr.indexOf('/');
  if (slashIndex <= 0 || slashIndex === modelStr.length - 1) throw new InvalidModelError(modelStr);
  return {
    platform: modelStr.slice(0, slashIndex),
    modelName: modelStr.slice(slashIndex + 1),
  };
}

export function parseRequestPath(pathname) {
  const openaiMatch = pathname.match(/^\/openai(\/.*)?$/);
  if (openaiMatch) return { protocol: 'openai', apiPath: openaiMatch[1] || '/' };

  const anthropicMatch = pathname.match(/^\/anthropic(\/.*)?$/);
  if (anthropicMatch) return { protocol: 'anthropic', apiPath: anthropicMatch[1] || '/' };

  if (pathname.startsWith('/v1/')) return { protocol: 'openai', apiPath: pathname };

  throw new InvalidPathError(pathname);
}

export function generateModelList(platforms) {
  const now = Math.floor(Date.now() / 1000);
  const data = [];
  for (const [platformId, platform] of Object.entries(platforms)) {
    for (const modelTag of Object.keys(platform.models || {})) {
      data.push({
        id: `${platformId}/${modelTag}`,
        object: 'model',
        created: now,
        owned_by: platform.name || platformId,
      });
    }
  }
  return { object: 'list', data };
}

export function verifyBearerToken(request, expectedToken) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  return auth.slice(7) === expectedToken;
}

export function verifyBasicAuth(request, expectedPassword) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Basic ')) return false;
  const decoded = atob(auth.slice(6));
  const colonIndex = decoded.indexOf(':');
  if (colonIndex === -1) return decoded === expectedPassword;
  return decoded.slice(colonIndex + 1) === expectedPassword;
}
```

- [ ] **Step 4: 运行测试，确认全部通过**

```bash
npm test -- test/utils.test.js
```

Expected: 14 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/utils.js test/utils.test.js
git commit -m "feat: utility functions"
```

---

## Task 4: config.js

**Files:**
- Create: `src/config.js`
- Create: `test/config.test.js`

- [ ] **Step 1: 写测试**

```javascript
// test/config.test.js
import { describe, it, expect, beforeEach } from 'vitest';
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
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm test -- test/config.test.js
```

Expected: FAIL，`Cannot find module '../src/config.js'`

- [ ] **Step 3: 实现 config.js**

```javascript
// src/config.js
const PLATFORMS_KEY = 'config:platforms';
const ACCESS_TOKEN_KEY = 'auth:access_token';

export async function getConfig(env) {
  const raw = await env.KV.get(PLATFORMS_KEY);
  if (!raw) return {};
  return JSON.parse(raw);
}

export async function setConfig(env, config) {
  await env.KV.put(PLATFORMS_KEY, JSON.stringify(config));
}

export async function getAccessToken(env) {
  return env.KV.get(ACCESS_TOKEN_KEY);
}

export async function setAccessToken(env, token) {
  await env.KV.put(ACCESS_TOKEN_KEY, token);
}

export function getAdminPassword(env) {
  return env.ADMIN_PASSWORD || '';
}
```

- [ ] **Step 4: 运行测试，确认全部通过**

```bash
npm test -- test/config.test.js
```

Expected: 7 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "feat: KV config helpers"
```

---

## Task 5: router.js

**Files:**
- Create: `src/router.js`
- Create: `test/router.test.js`

- [ ] **Step 1: 写测试**

```javascript
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
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm test -- test/router.test.js
```

Expected: FAIL，`Cannot find module '../src/router.js'`

- [ ] **Step 3: 实现 router.js**

```javascript
// src/router.js
import { getConfig } from './config.js';
import { parseModelTag, parseRequestPath, generateModelList } from './utils.js';
import {
  PlatformNotFoundError,
  ModelNotFoundError,
  ApiKeyMissingError,
  ConfigNotFoundError,
  InvalidPathError,
} from './errors.js';

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === '/health') return handleHealthCheck();
  if (pathname === '/v1/models') return handleListModels(env);

  return handleForwardRequest(request, env);
}

export async function handleForwardRequest(request, env) {
  try {
    const url = new URL(request.url);
    const { protocol, apiPath } = parseRequestPath(url.pathname);

    const body = await request.json();
    const { platform, modelName } = parseModelTag(body.model);

    const platforms = await getConfig(env);
    if (!platforms || Object.keys(platforms).length === 0) throw new ConfigNotFoundError();

    const platformConfig = platforms[platform];
    if (!platformConfig) throw new PlatformNotFoundError(platform);

    const modelConfig = platformConfig.models?.[modelName];
    if (!modelConfig) throw new ModelNotFoundError(modelName, platform);

    const apiKey = platformConfig.apiKey;
    if (!apiKey) throw new ApiKeyMissingError(platform);

    const baseUrl = platformConfig.baseUrls?.[protocol];
    if (!baseUrl) throw new InvalidPathError(`Protocol "${protocol}" not supported by platform "${platform}"`);

    const targetUrl = baseUrl.replace(/\/$/, '') + apiPath;
    const forwardBody = { ...body, model: modelConfig.internalName || modelName };

    const headers = new Headers();
    headers.set('Content-Type', 'application/json');

    if (protocol === 'anthropic') {
      headers.set('x-api-key', apiKey);
      headers.set('anthropic-version', '2023-06-01');
    } else {
      headers.set('Authorization', `Bearer ${apiKey}`);
    }

    return fetch(new Request(targetUrl, {
      method: request.method,
      headers,
      body: JSON.stringify(forwardBody),
    }));
  } catch (err) {
    if (err.toResponse) return err.toResponse();
    throw err;
  }
}

export async function handleListModels(env) {
  const platforms = await getConfig(env);
  return Response.json(generateModelList(platforms || {}));
}

export function handleHealthCheck() {
  return Response.json({ status: 'ok' });
}
```

- [ ] **Step 4: 运行测试，确认全部通过**

```bash
npm test -- test/router.test.js
```

Expected: 8 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/router.js test/router.test.js
git commit -m "feat: request router and forwarder"
```

---

## Task 6: admin.js

**Files:**
- Create: `src/admin.js`
- Create: `test/admin.test.js`

- [ ] **Step 1: 写测试**

```javascript
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
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm test -- test/admin.test.js
```

Expected: FAIL，`Cannot find module '../src/admin.js'`

- [ ] **Step 3: 实现 admin.js**

```javascript
// src/admin.js
import { getConfig, setConfig, setAccessToken } from './config.js';

export async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === '/admin' || pathname === '/admin/') {
    return new Response(ADMIN_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (pathname === '/admin/api/config') {
    if (request.method === 'GET') return handleGetConfig(env);
    if (request.method === 'PUT') return handlePutConfig(request, env);
  }

  if (pathname === '/admin/api/token' && request.method === 'PUT') {
    return handlePutToken(request, env);
  }

  return new Response('Not Found', { status: 404 });
}

async function handleGetConfig(env) {
  const config = await getConfig(env);
  const masked = {};
  for (const [id, platform] of Object.entries(config)) {
    masked[id] = {
      ...platform,
      apiKey: platform.apiKey
        ? '***' + platform.apiKey.slice(-4)
        : '',
    };
  }
  return Response.json(masked);
}

async function handlePutConfig(request, env) {
  const incoming = await request.json();
  const existing = await getConfig(env);

  // For each platform, if apiKey looks masked (starts with ***), restore the real one
  const merged = {};
  for (const [id, platform] of Object.entries(incoming)) {
    const realKey =
      platform.apiKey && platform.apiKey.startsWith('***')
        ? (existing[id]?.apiKey ?? '')
        : platform.apiKey;
    merged[id] = { ...platform, apiKey: realKey };
  }

  await setConfig(env, merged);
  return Response.json({ ok: true });
}

async function handlePutToken(request, env) {
  const { token } = await request.json();
  await setAccessToken(env, token);
  return Response.json({ ok: true });
}

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LLMBridge 设置</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #333; padding: 24px; }
    h1 { margin-bottom: 24px; font-size: 1.5rem; }
    h2 { font-size: 1.1rem; margin-bottom: 12px; }
    .card { background: #fff; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
    label { display: block; font-size: .85rem; margin-bottom: 4px; color: #555; }
    input, select { width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: .9rem; margin-bottom: 10px; }
    button { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: .9rem; }
    .btn-primary { background: #2563eb; color: #fff; }
    .btn-danger  { background: #dc2626; color: #fff; }
    .btn-ghost   { background: #e5e7eb; color: #333; }
    .platform { border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin-bottom: 12px; }
    .platform-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .model-row { display: flex; gap: 8px; margin-bottom: 6px; }
    .model-row input { margin-bottom: 0; }
    .actions { display: flex; gap: 8px; margin-top: 8px; }
    .msg { padding: 8px 12px; border-radius: 4px; margin-bottom: 12px; font-size: .9rem; }
    .msg.ok  { background: #dcfce7; color: #166534; }
    .msg.err { background: #fee2e2; color: #991b1b; }
  </style>
</head>
<body>
  <h1>LLMBridge 设置</h1>

  <div class="card">
    <h2>访问令牌</h2>
    <div id="token-msg"></div>
    <label>Bearer Token（客户端请求时携带）</label>
    <input id="token-input" type="text" placeholder="输入新 token">
    <button class="btn-primary" onclick="saveToken()">保存令牌</button>
  </div>

  <div class="card">
    <h2>平台配置</h2>
    <div id="config-msg"></div>
    <div id="platforms"></div>
    <div class="actions">
      <button class="btn-ghost" onclick="addPlatform()">+ 添加平台</button>
      <button class="btn-primary" onclick="saveConfig()">保存配置</button>
    </div>
  </div>

  <script>
    let config = {};

    async function loadConfig() {
      const res = await fetch('/admin/api/config');
      config = await res.json();
      renderPlatforms();
    }

    function renderPlatforms() {
      const el = document.getElementById('platforms');
      el.innerHTML = '';
      for (const [id, p] of Object.entries(config)) {
        el.appendChild(renderPlatform(id, p));
      }
    }

    function renderPlatform(id, p) {
      const div = document.createElement('div');
      div.className = 'platform';
      div.dataset.id = id;
      div.innerHTML = \`
        <div class="platform-header">
          <strong>\${p.name || id}</strong>
          <button class="btn-danger" onclick="removePlatform('\${id}')">删除</button>
        </div>
        <label>平台 ID（标签前缀，如 tx）</label>
        <input class="p-id" value="\${id}">
        <label>平台名称</label>
        <input class="p-name" value="\${p.name || ''}">
        <label>OpenAI 端点 Base URL</label>
        <input class="p-url-openai" value="\${p.baseUrls?.openai || ''}">
        <label>Anthropic 端点 Base URL（可选）</label>
        <input class="p-url-anthropic" value="\${p.baseUrls?.anthropic || ''}">
        <label>API Key</label>
        <input class="p-apikey" value="\${p.apiKey || ''}">
        <label>模型映射（标签名 → 实际模型名）</label>
        <div class="p-models">\${renderModels(p.models || {})}</div>
        <button class="btn-ghost" onclick="addModel(this)">+ 添加模型</button>
      \`;
      return div;
    }

    function renderModels(models) {
      return Object.entries(models).map(([tag, m]) =>
        \`<div class="model-row">
          <input class="m-tag" value="\${tag}" placeholder="标签名（如 glm-5）">
          <input class="m-internal" value="\${m.internalName || tag}" placeholder="实际模型名">
          <button class="btn-danger" onclick="this.closest('.model-row').remove()">×</button>
        </div>\`
      ).join('');
    }

    function addModel(btn) {
      const container = btn.previousElementSibling;
      const row = document.createElement('div');
      row.className = 'model-row';
      row.innerHTML = \`
        <input class="m-tag" placeholder="标签名（如 glm-5）">
        <input class="m-internal" placeholder="实际模型名">
        <button class="btn-danger" onclick="this.closest('.model-row').remove()">×</button>
      \`;
      container.appendChild(row);
    }

    function addPlatform() {
      const newId = 'new_' + Date.now();
      config[newId] = { name: '', baseUrls: { openai: '' }, apiKey: '', models: {} };
      renderPlatforms();
    }

    function removePlatform(id) {
      delete config[id];
      renderPlatforms();
    }

    function collectConfig() {
      const result = {};
      for (const div of document.querySelectorAll('.platform')) {
        const id = div.querySelector('.p-id').value.trim();
        if (!id) continue;
        const models = {};
        for (const row of div.querySelectorAll('.model-row')) {
          const tag = row.querySelector('.m-tag').value.trim();
          const internal = row.querySelector('.m-internal').value.trim();
          if (tag) models[tag] = { internalName: internal || tag };
        }
        result[id] = {
          name: div.querySelector('.p-name').value.trim(),
          baseUrls: {
            openai: div.querySelector('.p-url-openai').value.trim(),
            anthropic: div.querySelector('.p-url-anthropic').value.trim() || undefined,
          },
          apiKey: div.querySelector('.p-apikey').value,
          models,
        };
        if (!result[id].baseUrls.anthropic) delete result[id].baseUrls.anthropic;
      }
      return result;
    }

    async function saveConfig() {
      const msg = document.getElementById('config-msg');
      try {
        const res = await fetch('/admin/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(collectConfig()),
        });
        if (!res.ok) throw new Error(await res.text());
        msg.className = 'msg ok'; msg.textContent = '已保存';
        await loadConfig();
      } catch (e) {
        msg.className = 'msg err'; msg.textContent = '保存失败：' + e.message;
      }
    }

    async function saveToken() {
      const msg = document.getElementById('token-msg');
      const token = document.getElementById('token-input').value.trim();
      if (!token) { msg.className = 'msg err'; msg.textContent = '令牌不能为空'; return; }
      try {
        const res = await fetch('/admin/api/token', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) throw new Error(await res.text());
        msg.className = 'msg ok'; msg.textContent = '已保存';
        document.getElementById('token-input').value = '';
      } catch (e) {
        msg.className = 'msg err'; msg.textContent = '保存失败：' + e.message;
      }
    }

    loadConfig();
  </script>
</body>
</html>`;
```

- [ ] **Step 4: 运行测试，确认全部通过**

```bash
npm test -- test/admin.test.js
```

Expected: 7 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/admin.js test/admin.test.js
git commit -m "feat: admin panel and config API"
```

---

## Task 7: index.js

**Files:**
- Create: `src/index.js`
- Create: `test/index.test.js`

- [ ] **Step 1: 写测试**

```javascript
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
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm test -- test/index.test.js
```

Expected: FAIL，`Cannot find module '../src/index.js'`

- [ ] **Step 3: 实现 index.js**

```javascript
// src/index.js
import { handleRequest } from './router.js';
import { handleAdmin } from './admin.js';
import { getAccessToken, getAdminPassword } from './config.js';
import { verifyBearerToken, verifyBasicAuth } from './utils.js';
import { UnauthorizedError } from './errors.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    let response;

    if (url.pathname === '/health') {
      response = await handleRequest(request, env, ctx);
    } else if (url.pathname.startsWith('/admin')) {
      response = await handleAdminWithAuth(request, env);
    } else {
      response = await handleApiWithAuth(request, env, ctx);
    }

    const newHeaders = new Headers(response.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) newHeaders.set(k, v);
    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  },
};

async function handleAdminWithAuth(request, env) {
  const password = getAdminPassword(env);
  if (!verifyBasicAuth(request, password)) {
    return new UnauthorizedError().toResponse('Basic');
  }
  return handleAdmin(request, env);
}

async function handleApiWithAuth(request, env, ctx) {
  const token = await getAccessToken(env);
  if (!token || !verifyBearerToken(request, token)) {
    return new UnauthorizedError('Invalid or missing access token').toResponse();
  }
  return handleRequest(request, env, ctx);
}
```

- [ ] **Step 4: 运行测试，确认全部通过**

```bash
npm test -- test/index.test.js
```

Expected: 8 tests pass

- [ ] **Step 5: 运行所有测试**

```bash
npm test
```

Expected: 全部通过（约 44 tests）

- [ ] **Step 6: Commit**

```bash
git add src/index.js test/index.test.js
git commit -m "feat: worker entry with auth middleware"
```

---

## Task 8: 最终整合验证

- [ ] **Step 1: 运行完整测试套件**

```bash
npm test
```

Expected: 所有测试通过，无警告。

- [ ] **Step 2: 本地启动（需在 wrangler.toml 中填入真实 KV ID，或跳过 KV 相关验证）**

```bash
npm run dev
```

Expected: `Ready on http://localhost:8787`

- [ ] **Step 3: 验证 /health**

```bash
curl http://localhost:8787/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 4: 验证 /admin 需要 Basic Auth**

```bash
curl -i http://localhost:8787/admin
```

Expected: `HTTP/1.1 401`，`WWW-Authenticate: Basic realm="LLMBridge Admin"`

- [ ] **Step 5: 验证 /v1/models 需要 Bearer Token**

```bash
curl -i http://localhost:8787/v1/models
```

Expected: `HTTP/1.1 401`

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "chore: final integration verified"
```
