// src/admin.js
import { getConfig, setConfig, setAccessToken, getAdminPassword } from './config.js';

const SESSION_COOKIE = 'admin_sid';

export async function makeSessionToken(password) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(password),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('llmbridge-admin-v1'));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function verifyAdminSession(request, env) {
  const password = getAdminPassword(env);
  if (!password) return false;
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)admin_sid=([^;]+)/);
  if (!match) return false;
  const expected = await makeSessionToken(password);
  return match[1] === expected;
}

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
  const method = request.method;

  // Login (public)
  if (pathname === '/admin/login' || pathname === '/admin/login/') {
    if (method === 'GET') return loginPage();
    if (method === 'POST') return handleLogin(request, env);
  }

  // Logout (public) — clear cookie and redirect
  if (pathname === '/admin/logout') {
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/admin/login',
        'Set-Cookie': `${SESSION_COOKIE}=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
      },
    });
  }

  // Admin panel HTML
  if (pathname === '/admin' || pathname === '/admin/') {
    return new Response(ADMIN_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (pathname === '/admin/api/config') {
    if (method === 'GET') return handleGetConfig(env);
    if (method === 'PUT') return handlePutConfig(request, env);
  }

  if (pathname === '/admin/api/token' && method === 'PUT') {
    return handlePutToken(request, env);
  }

  return new Response('Not Found', { status: 404 });
}

async function handleLogin(request, env) {
  const password = getAdminPassword(env);
  if (!password) return new Response('ADMIN_PASSWORD not configured', { status: 500 });

  let formData;
  try { formData = await request.formData(); }
  catch { return loginPage('请求格式错误'); }

  if ((formData.get('password') || '') !== password) return loginPage('密码错误');

  const token = await makeSessionToken(password);
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/admin',
      'Set-Cookie': `${SESSION_COOKIE}=${token}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`,
    },
  });
}

function loginPage(errorMsg = '') {
  const html = errorMsg
    ? LOGIN_HTML.replace('<!--ERROR-->', `<p class="error">${errorMsg}</p>`)
    : LOGIN_HTML;
  return new Response(html, {
    status: errorMsg ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
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

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LLMBridge 登录</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f0f2f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.1); padding: 36px 40px; width: 340px; }
    .logo { font-size: 1.05rem; font-weight: 700; color: #1e293b; margin-bottom: 4px; }
    .subtitle { font-size: .82rem; color: #94a3b8; margin-bottom: 28px; }
    label { display: block; font-size: .78rem; font-weight: 500; color: #374151; margin-bottom: 5px; }
    input[type=password] { width: 100%; padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 7px; font-size: .875rem; outline: none; transition: border .15s, box-shadow .15s; }
    input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.12); }
    button { width: 100%; margin-top: 16px; padding: 10px; background: #2563eb; color: #fff; border: none; border-radius: 7px; font-size: .875rem; font-weight: 500; cursor: pointer; transition: background .12s; }
    button:hover { background: #1d4ed8; }
    .error { color: #dc2626; font-size: .8rem; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">LLMBridge</div>
    <div class="subtitle">管理面板</div>
    <form method="POST" action="/admin/login">
      <label>管理员密码</label>
      <input type="password" name="password" autofocus placeholder="输入密码">
      <!--ERROR-->
      <button type="submit">登录</button>
    </form>
  </div>
</body>
</html>`;

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LLMBridge 管理面板</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f0f2f5; color: #1a1a1a; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

    /* Header */
    .header { background: #1e293b; color: #fff; height: 52px; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .header h1 { font-size: .95rem; font-weight: 600; letter-spacing: .01em; }
    .logout-btn { background: none; border: 1px solid rgba(255,255,255,.25); color: rgba(255,255,255,.75); font-size: .78rem; padding: 4px 12px; border-radius: 5px; cursor: pointer; transition: all .15s; }
    .logout-btn:hover { border-color: rgba(255,255,255,.6); color: #fff; background: rgba(255,255,255,.1); }

    /* Layout */
    .layout { display: flex; flex: 1; overflow: hidden; }

    /* Sidebar */
    .sidebar { width: 220px; background: #fff; border-right: 1px solid #e2e8f0; display: flex; flex-direction: column; overflow: hidden; flex-shrink: 0; }
    .sidebar-scroll { flex: 1; overflow-y: auto; padding: 12px 10px 8px; }
    .section-title { font-size: .68rem; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: #94a3b8; padding: 0 8px; margin: 8px 0 4px; }
    .nav-item { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 6px; cursor: pointer; font-size: .85rem; color: #475569; transition: background .12s, color .12s; user-select: none; }
    .nav-item:hover { background: #f1f5f9; color: #1e293b; }
    .nav-item.active { background: #eff6ff; color: #2563eb; font-weight: 500; }
    .nav-dot { width: 7px; height: 7px; border-radius: 50%; background: #cbd5e1; flex-shrink: 0; transition: background .12s; }
    .nav-item.active .nav-dot { background: #2563eb; }
    .nav-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nav-badge { font-size: .65rem; background: #f1f5f9; color: #64748b; border-radius: 4px; padding: 1px 5px; font-family: monospace; flex-shrink: 0; }
    .nav-item.active .nav-badge { background: #dbeafe; color: #1d4ed8; }
    .sidebar-footer { padding: 10px; border-top: 1px solid #f1f5f9; flex-shrink: 0; }
    .add-btn { width: 100%; padding: 7px; border: 1.5px dashed #cbd5e1; border-radius: 6px; background: none; cursor: pointer; font-size: .8rem; color: #64748b; transition: all .15s; }
    .add-btn:hover { border-color: #2563eb; color: #2563eb; background: #eff6ff; }

    /* Main */
    .main { flex: 1; overflow-y: auto; padding: 28px 32px; }
    .card { background: #fff; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.07); max-width: 660px; }
    .card-head { padding: 18px 22px 16px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; }
    .card-head h2 { font-size: .95rem; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .card-body { padding: 20px 22px; }
    .card-foot { padding: 14px 22px; border-top: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; }

    /* Form */
    .field { margin-bottom: 15px; }
    .field:last-child { margin-bottom: 0; }
    .field > label { display: block; font-size: .78rem; font-weight: 500; color: #374151; margin-bottom: 5px; }
    .opt-label { color: #9ca3af; font-weight: 400; }
    .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    input[type=text], input[type=password] {
      width: 100%; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px;
      font-size: .875rem; outline: none; transition: border .15s, box-shadow .15s; background: #fff;
    }
    input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.12); }

    /* Models */
    .models-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .models-bar span { font-size: .78rem; font-weight: 500; color: #374151; }
    .model-cols { display: grid; grid-template-columns: 1fr 1fr 30px; gap: 8px; padding-bottom: 4px; }
    .col-hint { font-size: .7rem; color: #9ca3af; }
    .model-row { display: grid; grid-template-columns: 1fr 1fr 30px; gap: 8px; margin-bottom: 6px; align-items: center; }
    .model-row input { margin: 0; }
    .btn-x { width: 28px; height: 34px; border: none; border-radius: 5px; background: #fee2e2; color: #dc2626; cursor: pointer; font-size: 1rem; display: flex; align-items: center; justify-content: center; transition: background .12s; }
    .btn-x:hover { background: #fecaca; }

    /* Buttons */
    .btn { padding: 7px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: .85rem; font-weight: 500; transition: background .12s; }
    .btn-primary { background: #2563eb; color: #fff; }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-ghost { background: #f1f5f9; color: #475569; }
    .btn-ghost:hover { background: #e2e8f0; }
    .btn-danger { background: #fee2e2; color: #dc2626; }
    .btn-danger:hover { background: #fecaca; }

    /* Empty */
    .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 60vh; color: #94a3b8; gap: 10px; }
    .empty-icon { font-size: 2.5rem; }
    .empty p { font-size: .9rem; }

    /* Toast */
    #toast {
      position: fixed; bottom: 24px; right: 24px;
      padding: 11px 18px; border-radius: 8px; font-size: .875rem; font-weight: 500;
      box-shadow: 0 4px 16px rgba(0,0,0,.18); z-index: 9999;
      transform: translateY(12px); opacity: 0;
      transition: transform .25s ease, opacity .25s ease;
      pointer-events: none;
    }
    #toast.show { transform: translateY(0); opacity: 1; }
    #toast.ok  { background: #1e293b; color: #fff; }
    #toast.err { background: #dc2626; color: #fff; }
  </style>
</head>
<body>
<header class="header"><h1>LLMBridge 管理面板</h1><button class="logout-btn" onclick="logout()">退出登录</button></header>
<div class="layout">
  <nav class="sidebar">
    <div class="sidebar-scroll">
      <div class="section-title">系统</div>
      <div class="nav-item active" id="nav-token" onclick="selectView('token')">
        <div class="nav-dot"></div>
        <span class="nav-label">访问令牌</span>
      </div>
      <div class="section-title" style="margin-top:12px">平台</div>
      <div id="platform-nav"></div>
    </div>
    <div class="sidebar-footer">
      <button class="add-btn" onclick="addPlatform()">+ 添加平台</button>
    </div>
  </nav>
  <main class="main" id="main"></main>
</div>
<div id="toast"></div>

<script>
  let config = {};
  let currentView = 'token';

  async function loadConfig() {
    const res = await fetch('/admin/api/config', { credentials: 'include' });
    config = await res.json();
    renderNav();
    renderView(currentView);
  }

  function renderNav() {
    const nav = document.getElementById('platform-nav');
    nav.innerHTML = '';
    for (const [id, p] of Object.entries(config)) {
      const el = document.createElement('div');
      el.className = 'nav-item' + (currentView === id ? ' active' : '');
      el.id = 'nav-' + CSS.escape(id);
      el.onclick = () => selectView(id);
      el.innerHTML = \`<div class="nav-dot"></div><span class="nav-label">\${esc(p.name || id)}</span><span class="nav-badge">\${esc(id)}</span>\`;
      nav.appendChild(el);
    }
  }

  function selectView(view) {
    currentView = view;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navEl = document.getElementById('nav-' + CSS.escape(view)) || document.getElementById('nav-' + view);
    if (navEl) navEl.classList.add('active');
    renderView(view);
  }

  function renderView(view) {
    const main = document.getElementById('main');
    if (view === 'token') {
      main.innerHTML = tokenView();
    } else if (config[view]) {
      main.innerHTML = platformView(view, config[view]);
    } else {
      main.innerHTML = \`<div class="empty"><div class="empty-icon">🔌</div><p>从左侧选择平台，或添加新平台</p></div>\`;
    }
  }

  function tokenView() {
    return \`<div class="card">
      <div class="card-head"><h2>访问令牌</h2></div>
      <div class="card-body">
        <div class="field">
          <label>新 Token（留空则不修改）</label>
          <input type="password" id="token-input" placeholder="输入新 token">
        </div>
        <p style="font-size:.78rem;color:#9ca3af;margin-top:4px">客户端通过 Authorization: Bearer 或 x-api-key 携带此 token</p>
      </div>
      <div class="card-foot">
        <span></span>
        <button class="btn btn-primary" onclick="saveToken()">保存令牌</button>
      </div>
    </div>\`;
  }

  function platformView(id, p) {
    const modelRows = Object.entries(p.models || {}).map(([tag, m]) => \`
      <div class="model-row">
        <input type="text" class="m-tag" value="\${esc(tag)}" placeholder="标签（如 glm-5）">
        <input type="text" class="m-internal" value="\${esc(m.internalName || tag)}" placeholder="实际模型名">
        <button class="btn-x" onclick="this.closest('.model-row').remove()" title="删除">×</button>
      </div>\`).join('');

    return \`<div class="card">
      <div class="card-head">
        <h2>\${esc(p.name || id)} <span class="nav-badge">\${esc(id)}</span></h2>
      </div>
      <div class="card-body">
        <div class="row2">
          <div class="field">
            <label>平台 ID（模型标签前缀）</label>
            <input type="text" id="p-id" value="\${esc(id)}">
          </div>
          <div class="field">
            <label>平台名称</label>
            <input type="text" id="p-name" value="\${esc(p.name || '')}">
          </div>
        </div>
        <div class="field">
          <label>OpenAI 兼容端点 Base URL</label>
          <input type="text" id="p-url-openai" value="\${esc(p.baseUrls?.openai || '')}">
        </div>
        <div class="field">
          <label>Anthropic 兼容端点 Base URL <span class="opt-label">（可选）</span></label>
          <input type="text" id="p-url-anthropic" value="\${esc(p.baseUrls?.anthropic || '')}">
        </div>
        <div class="field">
          <label>API Key</label>
          <input type="password" id="p-apikey" value="\${esc(p.apiKey || '')}" placeholder="留空则保留现有 Key">
        </div>
        <div class="field">
          <div class="models-bar">
            <span>模型映射</span>
            <button class="btn btn-ghost" style="padding:4px 10px;font-size:.78rem" onclick="addModelRow()">+ 添加模型</button>
          </div>
          <div class="model-cols">
            <div class="col-hint">标签名（客户端使用）</div>
            <div class="col-hint">实际模型名（转发上游）</div>
            <div></div>
          </div>
          <div id="model-list">\${modelRows}</div>
        </div>
      </div>
      <div class="card-foot">
        <button class="btn btn-danger" onclick="deletePlatform('\${esc(id)}')">删除平台</button>
        <button class="btn btn-primary" onclick="savePlatform('\${esc(id)}')">保存</button>
      </div>
    </div>\`;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function addModelRow() {
    const list = document.getElementById('model-list');
    const row = document.createElement('div');
    row.className = 'model-row';
    row.innerHTML = \`
      <input type="text" class="m-tag" placeholder="标签（如 glm-5）">
      <input type="text" class="m-internal" placeholder="实际模型名">
      <button class="btn-x" onclick="this.closest('.model-row').remove()">×</button>\`;
    list.appendChild(row);
    row.querySelector('.m-tag').focus();
  }

  function addPlatform() {
    const id = 'new_' + Date.now();
    config[id] = { name: '新平台', baseUrls: { openai: '' }, apiKey: '', models: {} };
    renderNav();
    selectView(id);
  }

  function deletePlatform(id) {
    if (!confirm(\`确认删除平台 "\${id}"？\`)) return;
    delete config[id];
    saveAllConfig().then(() => { selectView('token'); renderNav(); });
  }

  async function savePlatform(originalId) {
    const newId = document.getElementById('p-id').value.trim();
    if (!newId) { toast('平台 ID 不能为空', 'err'); return; }

    const models = {};
    for (const row of document.querySelectorAll('#model-list .model-row')) {
      const tag = row.querySelector('.m-tag').value.trim();
      const internal = row.querySelector('.m-internal').value.trim();
      if (tag) models[tag] = { internalName: internal || tag };
    }

    const apiKeyInput = document.getElementById('p-apikey').value;
    const realKey = apiKeyInput.startsWith('***')
      ? (config[originalId]?.apiKey ?? '') : apiKeyInput;

    const anthropicUrl = document.getElementById('p-url-anthropic').value.trim();
    const baseUrls = { openai: document.getElementById('p-url-openai').value.trim() };
    if (anthropicUrl) baseUrls.anthropic = anthropicUrl;

    if (originalId !== newId) delete config[originalId];
    config[newId] = {
      name: document.getElementById('p-name').value.trim(),
      baseUrls, apiKey: realKey, models,
    };

    await saveAllConfig();
    currentView = newId;
    renderNav();
    renderView(newId);
  }

  async function saveAllConfig() {
    const res = await fetch('/admin/api/config', {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) { toast('保存失败', 'err'); throw new Error('save failed'); }
    const fresh = await fetch('/admin/api/config', { credentials: 'include' });
    config = await fresh.json();
    toast('已保存', 'ok');
  }

  async function saveToken() {
    const input = document.getElementById('token-input');
    const token = input.value.trim();
    if (!token) { toast('令牌不能为空', 'err'); return; }
    const res = await fetch('/admin/api/token', {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) { toast('保存失败', 'err'); return; }
    input.value = '';
    toast('令牌已更新', 'ok');
  }

  let _toastTimer;
  function toast(msg, type) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = \`\${type} show\`;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  function logout() {
    location.href = '/admin/logout';
  }

  loadConfig();
</script>
</body>
</html>`;
