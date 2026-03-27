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
