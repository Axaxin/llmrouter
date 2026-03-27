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
