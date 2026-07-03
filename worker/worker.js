// Ofek AI proxy worker.
//
// Bring-your-own-key only:
//   Ofek -> this Worker -> selected provider using the user's key for that request.
//
// There is no app-owned Groq/OpenAI/OpenRouter key path in this Worker.
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
  }
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://gefenrose.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
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
  return PROVIDERS[providerName] ? providerName : DEFAULT_PROVIDER;
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
  const provider = PROVIDERS[providerName] || PROVIDERS[DEFAULT_PROVIDER];
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };

  if (providerName === 'openrouter') {
    headers['HTTP-Referer'] = origin || 'https://gefenrose.github.io';
    headers['X-Title'] = 'Ofek';
  }

  return fetch(provider.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: Math.min(Math.max(Number(maxTokens) || 300, 64), 900),
      temperature: 0.7
    })
  });
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
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

    const body = await readBody(request);
    if (!body) {
      return jsonResponse({ error: 'Invalid JSON' }, { status: 400 }, origin);
    }

    if (!body.system || !Array.isArray(body.messages)) {
      return jsonResponse({ error: 'Missing system or messages' }, { status: 400 }, origin);
    }

    const providerName = providerFromBody(body);
    const apiKey = apiKeyFromBody(body);
    if (!apiKey) {
      return jsonResponse({
        error: 'Missing user API key',
        detail: 'Ofek does not include an app-owned AI API key. Enter your own API key in Settings > AI connection.'
      }, { status: 401 }, origin);
    }

    const messages = normalizeMessages(body.system, body.messages);
    const modelUsed = modelFromBody(body, providerName);
    const maxTokens = body.max_tokens || body.maxTokens || 300;

    const upstream = await callProvider({
      providerName,
      model: modelUsed,
      messages,
      apiKey,
      maxTokens,
      origin
    });

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
        detail: data?.error?.message || data?.error || upstreamText.slice(0, 600)
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
