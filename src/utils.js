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
  if (!expectedPassword) return false;
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Basic ')) return false;
  const decoded = atob(auth.slice(6));
  const colonIndex = decoded.indexOf(':');
  if (colonIndex === -1) return decoded === expectedPassword;
  return decoded.slice(colonIndex + 1) === expectedPassword;
}
