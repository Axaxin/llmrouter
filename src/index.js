// src/index.js
import { handleRequest } from './router.js';
import { handleAdmin, verifyAdminSession } from './admin.js';
import { getAccessToken } from './config.js';
import { verifyApiToken } from './utils.js';
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
  const url = new URL(request.url);
  // Login and logout are public — no session required
  if (url.pathname.startsWith('/admin/login') || url.pathname === '/admin/logout') {
    return handleAdmin(request, env);
  }
  if (!await verifyAdminSession(request, env)) {
    return new Response(null, { status: 302, headers: { 'Location': '/admin/login' } });
  }
  return handleAdmin(request, env);
}

async function handleApiWithAuth(request, env, ctx) {
  const token = await getAccessToken(env);
  if (!token || !verifyApiToken(request, token)) {
    return new UnauthorizedError('Invalid or missing access token').toResponse();
  }
  return handleRequest(request, env, ctx);
}
