// Ofek AI proxy worker.
//
// Bring-your-own-key only:
//   Ofek -> this Worker -> selected provider using the user's key for that request.
//
// There is no app-owned AI API key path in this Worker.
// User-provided keys are never stored by the Worker; they are forwarded only
// for the current request.
//
// Response contract for the frontend stays stable:
//   { content: [{ text: "..." }] }

const ALLOWED_ORIGINS = new Set([
  'https://gefens-serenity.pages.dev',
  'https://gefenrose.github.io',
  'https://ofek.pages.dev',
  'capacitor://localhost',
  'https://localhost',
  'http://localhost'
]);

const DEFAULT_PROVIDER = 'groq';
const MAX_BODY_BYTES = 256 * 1024;
const MAX_SYSTEM_CHARS = 20000;
const MAX_MESSAGES = 80;
const MAX_MESSAGE_CHARS = 30000;
const PROVIDER_TIMEOUT_MS = 60000;

const PROVIDERS = {
  groq: {
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b-versatile'
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4.1-mini'
  },
  openrouter: {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'meta-llama/llama-3.1-8b-instruct'
  },
  gemini: {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-3.5-flash'
  }
};

const SECURITY_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Resource-Policy': 'same-site'
};

function allowedOrigin(origin) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };

  if (allowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return {
    ...headers,
    ...SECURITY_HEADERS
  };
}

function jsonResponse(payload, init = {}, origin = '') {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
}

function cleanTextPart(part) {
  if (typeof part === 'string') return part;
  if (part && typeof part.text === 'string') return part.text;
  if (part && typeof part.content === 'string') return part.content;
  return '';
}

function extractText(data) {
  const rawContent = data?.choices?.[0]?.message?.content;
  if (typeof rawContent === 'string') return rawContent;
  if (Array.isArray(rawContent)) return rawContent.map(cleanTextPart).join('');

  const normalized = data?.content?.[0]?.text;
  if (typeof normalized === 'string') return normalized;

  return '';
}

function extractProviderError(data, fallbackText) {
  const candidates = [
    data?.error?.message,
    data?.error?.error?.message,
    Array.isArray(data) ? data[0]?.error?.message : '',
    Array.isArray(data) ? data[0]?.error?.error?.message : '',
    data?.message,
    typeof data?.error === 'string' ? data.error : ''
  ];

  const message = candidates.find((value) => typeof value === 'string' && value.trim());
  if (message) return message.trim();

  if (typeof fallbackText === 'string' && fallbackText.trim()) {
    return fallbackText.slice(0, 600);
  }

  return 'Provider returned an error response';
}

function normalizeMessages(system, messages) {
  return [
    { role: 'system', content: system },
    ...messages.map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message.content ?? '')
    }))
  ];
}

function providerFromBody(body) {
  const ai = body.ai && typeof body.ai === 'object' ? body.ai : {};
  const providerName = String(ai.provider || body.provider || DEFAULT_PROVIDER).toLowerCase();
  return PROVIDERS[providerName] ? providerName : null;
}

function apiKeyFromBody(body) {
  const ai = body.ai && typeof body.ai === 'object' ? body.ai : {};
  const userKey = ai.apiKey || body.apiKey || body.userApiKey;
  if (typeof userKey === 'string' && userKey.trim()) {
    return userKey.trim();
  }
  return '';
}

function modelFromBody(body, providerName) {
  const ai = body.ai && typeof body.ai === 'object' ? body.ai : {};
  const provider = PROVIDERS[providerName] || PROVIDERS[DEFAULT_PROVIDER];
  const requested = ai.model || body.model;
  return typeof requested === 'string' && requested.trim() ? requested.trim() : provider.defaultModel;
}

async function callProvider({ providerName, model, messages, apiKey, maxTokens, origin }) {
  const provider = PROVIDERS[providerName];
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };

  if (providerName === 'openrouter') {
    headers['HTTP-Referer'] = origin || 'https://gefenrose.github.io';
    headers['X-Title'] = 'Ofek';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(provider.endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: Math.min(Math.max(Number(maxTokens) || 300, 64), 900),
        temperature: 0.7
      })
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readBody(request) {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > MAX_BODY_BYTES) return { error: 'Request body too large', status: 413 };
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return { error: 'Request body too large', status: 413 };
    return { body: JSON.parse(text) };
  } catch {
    return { error: 'Invalid JSON', status: 400 };
  }
}

function validateConversation(body) {
  if (typeof body.system !== 'string' || !body.system.trim() || !Array.isArray(body.messages)) {
    return 'Missing system or messages';
  }
  if (body.system.length > MAX_SYSTEM_CHARS) return 'System message is too long';
  if (body.messages.length > MAX_MESSAGES) return 'Too many messages';
  const invalid = body.messages.some((message) => !message ||
    (message.role !== 'user' && message.role !== 'assistant') ||
    typeof message.content !== 'string' || message.content.length > MAX_MESSAGE_CHARS);
  return invalid ? 'Invalid message format' : '';
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: allowedOrigin(origin) ? 204 : 403, headers: corsHeaders(origin) });
    }

    if (request.method === 'GET') {
      return jsonResponse({
        ok: true,
        service: 'ofek-api',
        mode: 'bring-your-own-key-only',
        hasAppOwnedApiKey: false,
        supportsBringYourOwnKey: true,
        providers: Object.fromEntries(Object.entries(PROVIDERS).map(([name, value]) => [name, { defaultModel: value.defaultModel }]))
      }, { status: 200 }, origin);
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, origin);
    }

    if (!allowedOrigin(origin)) {
      return jsonResponse({ error: 'Origin not allowed' }, { status: 403 }, origin);
    }

    const parsed = await readBody(request);
    if (parsed.error) {
      return jsonResponse({ error: parsed.error }, { status: parsed.status }, origin);
    }
    const body = parsed.body;

    const conversationError = validateConversation(body);
    if (conversationError) {
      return jsonResponse({ error: conversationError }, { status: 400 }, origin);
    }

    const providerName = providerFromBody(body);
    if (!providerName) {
      return jsonResponse({ error: 'Unsupported AI provider' }, { status: 400 }, origin);
    }
    const apiKey = apiKeyFromBody(body);
    if (!apiKey) {
      return jsonResponse({
        error: 'Missing user API key',
        detail: 'Ofek does not include an app-owned AI API key. Enter your own API key in Settings > AI connection.'
      }, { status: 401 }, origin);
    }

    const messages = normalizeMessages(body.system, body.messages);
    const modelUsed = modelFromBody(body, providerName);
    if (modelUsed.length > 160 || !/^[a-zA-Z0-9._:/-]+$/.test(modelUsed)) {
      return jsonResponse({ error: 'Invalid model name' }, { status: 400 }, origin);
    }
    const maxTokens = body.max_tokens || body.maxTokens || 300;

    let upstream;
    try {
      upstream = await callProvider({
        providerName,
        model: modelUsed,
        messages,
        apiKey,
        maxTokens,
        origin
      });
    } catch (error) {
      const timedOut = error && error.name === 'AbortError';
      return jsonResponse({
        error: timedOut ? 'AI provider timed out' : 'AI provider unavailable',
        provider: providerName,
        model: modelUsed
      }, { status: timedOut ? 504 : 502 }, origin);
    }

    const upstreamText = await upstream.text();
    let data;
    try {
      data = JSON.parse(upstreamText);
    } catch {
      data = null;
    }

    if (!upstream.ok) {
      return jsonResponse({
        error: 'AI provider request failed',
        provider: providerName,
        model: modelUsed,
        status: upstream.status,
        detail: extractProviderError(data, upstreamText)
      }, { status: upstream.status }, origin);
    }

    const text = extractText(data);
    if (!text) {
      return jsonResponse({
        error: 'AI provider returned an empty response',
        provider: providerName,
        model: modelUsed
      }, { status: 502 }, origin);
    }

    return jsonResponse({
      content: [{ text }],
      provider: providerName,
      model: modelUsed,
      keySource: 'user'
    }, { status: 200 }, origin);
  }
};
