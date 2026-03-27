# LLMBridge - 多云 LLM 聚合 Worker 设计文档

## 1. 概述

通过 Cloudflare Worker 聚合多个云平台的 LLM 服务。用户通过单一 `base_url`（如 `https://llmbridge.cc/openai`）+ 模型标签（如 `tx/glm-5`）自动路由到对应平台。

平台配置、模型映射、API Key 等均通过 **Web 设置面板**在运行时管理，无需重新部署。

**核心流程：**
```
POST https://llmbridge.cc/openai/v1/chat/completions
  headers: { Authorization: Bearer <access_token> }
  body: { model: "tx/glm-5", messages: [...] }
    ↓
Worker: 验证 access_token
        识别 /openai/ → protocol="openai"
        解析 "tx/glm-5" → platform="tx", model="glm-5"
        从 KV 获取腾讯云端点 + API Key
    ↓
转发: POST https://api.tencentcloudbase.com/v1/chat/completions
      (model 映射为 "glm-5", 添加 Authorization header)
    ↓
返回: 直接代理响应（包括流式）
```

---

## 2. 项目结构

```
llmbridge-worker/
├── src/
│   ├── index.js           # Worker 入口，CORS 处理，auth 中间件
│   ├── config.js          # KV 配置的 schema 定义与默认值
│   ├── router.js          # 请求路由和转发
│   ├── admin.js           # 设置面板逻辑（页面渲染 + API）
│   ├── errors.js          # 错误类定义
│   └── utils.js           # 工具函数
├── wrangler.toml
├── package.json
└── README.md
```

---

## 3. 核心设计

### 3.1 请求路径规则

| 路径 | 协议 | 说明 |
|------|------|------|
| `/openai/v1/...` | OpenAI | 显式指定 |
| `/anthropic/v1/...` | Anthropic | 显式指定 |
| `/v1/...` | OpenAI（默认） | 默认协议 |
| `/v1/models` | - | 获取模型列表 |
| `/health` | - | 健康检查（无需 token） |
| `/admin` | - | 设置面板（密码保护） |
| `/admin/api/...` | - | 设置面板 API（密码保护） |

### 3.2 模型标签格式

```
<platform>/<model_name>

示例:
  tx/glm-5          # 腾讯云 GLM-5
  jd/qwen-14b       # 京东云 Qwen 14B
  jd/glm-5          # 京东云 GLM-5
```

### 3.3 配置存储

**环境变量（wrangler secret）：**

| 变量名 | 用途 |
|--------|------|
| `ADMIN_PASSWORD` | 设置面板登录密码，部署时设置，可在 Cloudflare 控制台修改 |
| `ACCESS_TOKEN` | API 访问令牌，调用方需在 Bearer Token 中携带 |

**Cloudflare KV（运行时可读写）：**

| KV Key | 内容 |
|--------|------|
| `config:platforms` | 平台配置 JSON（见下方） |

`config:platforms` 的结构：
```json
{
  "tx": {
    "name": "Tencent Cloud",
    "baseUrls": {
      "openai": "https://api.tencentcloudbase.com",
      "anthropic": "https://api.tencentcloudbase.com/anthropic"
    },
    "apiKey": "sk-xxxxxx",
    "models": {
      "glm-5": { "internalName": "glm-5" },
      "glm-4": { "internalName": "glm-4" }
    }
  },
  "jd": {
    "name": "JD Cloud",
    "baseUrls": {
      "openai": "https://api.jdcloud.com/v1"
    },
    "apiKey": "sk-yyyyyy",
    "models": {
      "qwen-14b": { "internalName": "qwen-14b-chat" }
    }
  }
}
```

> **注意**：`apiKey` 明文存储在 KV 中，KV 本身不加密，适合个人使用场景。

### 3.4 认证模型

```
           ┌─────────────────────────────┐
           │         请求进入             │
           └─────────────┬───────────────┘
                         │
              ┌──────────▼──────────┐
              │   /health 或 CORS   │ → 直接响应（无需认证）
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  路径以 /admin 开头？ │
              └──────────┬──────────┘
              Yes         │          No
               ↓          │           ↓
        Basic Auth 验证    │    Bearer Token 验证
        admin_password    │    access_token
               │          │           │
           失败→401    失败→401    失败→401
               │                      │
        进入设置面板               进入路由转发
```

---

## 4. 模块职责

### 4.1 src/config.js

**职责：** 定义 KV 配置的 schema、默认值和读写封装

**需要实现：**
- `CONFIG_SCHEMA` - 配置结构定义（用于前端表单生成和验证）
- `getConfig(env)` - 从 KV 读取平台配置，返回解析后的对象
- `setConfig(env, config)` - 将平台配置写入 KV
- `getAccessToken(env)` - 直接返回 `env.ACCESS_TOKEN`
- `getAdminPassword(env)` - 直接返回 `env.ADMIN_PASSWORD`

---

### 4.2 src/utils.js

**职责：** 提供工具函数

**需要实现的函数：**
1. `parseModelTag(modelStr)` - "tx/glm-5" → `{ platform: "tx", modelName: "glm-5" }`
2. `parseRequestPath(pathname)` - "/openai/v1/chat/completions" → `{ protocol: "openai", apiPath: "/v1/chat/completions" }`
3. `generateModelList(platforms)` - 生成 OpenAI 格式的模型列表（从 KV 配置）
4. `verifyBasicAuth(request, password)` - 验证 Basic Auth header
5. `verifyBearerToken(request, token)` - 验证 Bearer token

---

### 4.3 src/errors.js

**职责：** 错误处理

**需要实现：**
- 基类 `AggregatorError` 和具体错误类：
  - `InvalidModelError` (400)
  - `PlatformNotFoundError` (400)
  - `ModelNotFoundError` (400)
  - `ApiKeyMissingError` (500)
  - `InvalidPathError` (400)
  - `UnauthorizedError` (401)
  - `ConfigNotFoundError` (500) - KV 中无配置时

**错误响应格式：**
```json
{
  "error": {
    "message": "...",
    "type": "invalid_request_error"
  }
}
```

---

### 4.4 src/router.js

**职责：** 路由和请求转发

**需要实现的函数：**

1. `handleRequest(request, env, ctx)` - 主入口
   - 处理 CORS 预检
   - 路由到 `/health`、`/v1/models`、`/admin/*` 或 `handleForwardRequest`

2. `handleForwardRequest(request, env)` - 核心转发逻辑
   - 解析路径 → 获取 protocol 和 apiPath
   - 解析请求体 → 获取 model 字段
   - 解析模型标签 → 获取 platform 和 modelName
   - 从 KV 查询配置 → 验证平台和模型存在
   - 获取 API Key → 验证非空
   - 构建目标 URL = `baseUrl + apiPath`
   - 映射模型名称（internalName）
   - **处理协议差异**（见 3.5）
   - 转发请求到上游，代理响应（包括流式）

3. `handleListModels(env)` - 从 KV 读取配置并返回模型列表

4. `handleHealthCheck()` - 返回健康状态

---

### 4.5 src/admin.js

**职责：** 设置面板的页面渲染和配置 API

**路由：**

| 路径 | 方法 | 说明 |
|------|------|------|
| `GET /admin` | GET | 返回设置面板 HTML |
| `GET /admin/api/config` | GET | 读取当前平台配置（apiKey 脱敏显示） |
| `PUT /admin/api/config` | PUT | 保存平台配置到 KV |
| `PUT /admin/api/token` | PUT | 更新 access_token |
| `PUT /admin/api/password` | PUT | 更新面板密码 |

**所有 `/admin/*` 请求均需通过 Basic Auth 验证。**

**设置面板 UI 功能：**
- 平台列表（增删平台）
- 每个平台：名称、OpenAI 端点、Anthropic 端点（可选）、API Key
- 每个平台下的模型列表（增删模型）：标签名 → 实际模型名
- Access Token 设置
- 面板密码修改

---

### 4.6 src/index.js

**职责：** Worker 入口

**需要实现：**
- 默认导出包含 `fetch(request, env, ctx)` 方法的对象
- 统一 CORS 头处理（所有响应）
- OPTIONS 请求直接返回 204
- `/health` 无需认证直接响应
- `/admin/*` 路径 → Basic Auth 验证 → `admin.js`
- 其他路径 → Bearer Token 验证 → `router.js`

---

### 3.5 OpenAI vs Anthropic 协议差异

| 差异点 | OpenAI | Anthropic |
|--------|--------|-----------|
| Auth Header | `Authorization: Bearer <key>` | `x-api-key: <key>` |
| 版本 Header | 无 | `anthropic-version: 2023-06-01` |
| 请求体 | 标准 OpenAI 格式 | Anthropic Messages 格式 |

当 `protocol === "anthropic"` 时，`handleForwardRequest` 需要：
1. 将 auth header 改为 `x-api-key`
2. 添加 `anthropic-version` header
3. **透传请求体**（不做格式转换，由调用方负责使用正确格式）

---

## 5. 配置文件

### wrangler.toml
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

### package.json
```json
{
  "name": "llmbridge-worker",
  "version": "1.0.0",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "deploy:prod": "wrangler deploy --env production"
  },
  "devDependencies": {
    "wrangler": "^3.0.0"
  }
}
```

---

## 6. 部署流程

### 首次部署

1. **在 Cloudflare 控制台创建 KV Namespace**
   - Workers & Pages → KV → Create namespace
   - 名称填 `LLMBRIDGE_CONFIG`，记下生成的 Namespace ID
   - 将 ID 填入 `wrangler.toml` 的 `id` 字段

2. **设置环境变量**
   - Workers & Pages → 你的 Worker → Settings → Variables and Secrets
   - 添加 `ADMIN_PASSWORD`（面板密码）
   - 添加 `ACCESS_TOKEN`（API 访问令牌）

3. **绑定 KV**
   - 同一页面 → KV Namespace Bindings → Add binding
   - Variable name 填 `KV`，选择刚创建的 namespace

4. **连接 GitHub 仓库**
   - Workers & Pages → Create → Workers → Connect to Git
   - 选择仓库，Build command 留空，Deploy command: `wrangler deploy`

5. **推送代码触发部署**
   ```bash
   git push origin main
   ```

### 后续更新

推送到 main 分支即自动触发部署。

### 本地开发

```bash
npm run dev
# 访问 http://localhost:8787/admin 进入设置面板
```

---

## 7. 测试请求

```bash
# 健康检查（无需 token）
curl http://localhost:8787/health

# 获取模型列表
curl http://localhost:8787/v1/models \
  -H "Authorization: Bearer your_token"

# 测试腾讯云 GLM-5
curl -X POST http://localhost:8787/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "model": "tx/glm-5",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 100
  }'

# 访问设置面板
open http://localhost:8787/admin
```

---

## 8. 使用示例

### Python (OpenAI SDK)
```python
from openai import OpenAI

client = OpenAI(
    api_key="your_access_token",
    base_url="https://llmbridge.cc/openai"
)

response = client.chat.completions.create(
    model="tx/glm-5",
    messages=[{"role": "user", "content": "Hello"}]
)
```

### JavaScript
```javascript
const response = await fetch('https://llmbridge.cc/openai/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your_access_token'
  },
  body: JSON.stringify({
    model: 'tx/glm-5',
    messages: [{ role: 'user', content: 'Hello' }]
  })
});
```

---

## 9. 扩展

### 添加新平台
登录设置面板 `/admin`，在平台列表中点击"添加平台"，填写端点和 API Key 即可。无需重新部署。

### 添加新模型
在设置面板中找到对应平台，在模型列表中添加新的标签名和实际模型名映射。

---

## 10. 关键点

- ✅ 无外部依赖，纯 Cloudflare Workers API
- ✅ 配置驱动，运行时通过面板管理，无需重新部署
- ✅ KV 存储，配置持久化
- ✅ Bearer Token 保护 API 端点
- ✅ Basic Auth 保护设置面板
- ✅ 标准 OpenAI 错误格式
- ✅ 支持流式响应
- ✅ CORS 友好
- ✅ 支持 OpenAI 和 Anthropic 两种协议
