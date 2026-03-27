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
