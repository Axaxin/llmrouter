// src/admin.js
import { getConfig, setConfig, setAccessToken } from './config.js';

export async function handleAdmin(request, env) {
  try {
    return await _handleAdmin(request, env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return Response.json({ error: { message: msg, type: 'api_error' } }, { status: 500 });
  }
}

async function _handleAdmin(request, env) {
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
      apiKey: platform.apiKey ? '***' + platform.apiKey.slice(-4) : '',
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
    input { width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: .9rem; margin-bottom: 10px; }
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
      const res = await fetch('/admin/api/config', { credentials: 'include' });
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
          credentials: 'include',
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
          credentials: 'include',
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
