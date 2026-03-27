// src/router.js
import { getConfig } from './config.js';
import { parseModelTag, parseRequestPath, generateModelList } from './utils.js';
import {
  PlatformNotFoundError,
  ModelNotFoundError,
  ApiKeyMissingError,
  ConfigNotFoundError,
  InvalidPathError,
  InvalidModelError,
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

    let body;
    try {
      body = await request.json();
    } catch {
      throw new InvalidModelError('(unparseable body)');
    }
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

    return fetch(targetUrl, {
      method: request.method,
      headers,
      body: JSON.stringify(forwardBody),
    });
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
