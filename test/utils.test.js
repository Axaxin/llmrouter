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
