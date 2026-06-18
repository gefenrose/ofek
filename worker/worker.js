// Proxies chat requests from the serenity app (PWA + Capacitor native builds)
// to OpenRouter (free tier, OpenAI-compatible), keeping the API key
// server-side. Deploy with wrangler (see README).
//
// The response is translated back into the same shape the frontend
// already expects ({ content: [{ text }] }), so index.html doesn't
// need to know which model is behind this.

const ALLOWED_ORIGINS = new Set([
  'https://gefens-serenity.pages.dev', // Cloudflare Pages PWA
  'https://gefenrose.github.io',       // GitHub Pages PWA (legacy/alt deployment) - covers both /serenity/ and /ofek/
  'capacitor://localhost',             // Capacitor iOS
  'https://localhost',                 // Capacitor Android (default scheme since v6) / iOS with iosScheme:'https'
  'http://localhost'                   // Capacitor Android (pre-v6 default scheme)
]);

// Chosen for Hebrew quality + reasoning. OpenRouter's free catalog rotates,
// so if this model gets retired/renamed (upstream returns 400/404), the
// code below automatically retries with the auto-selecting free router.
// Re-check current free model IDs at https://openrouter.ai/models?max_price=0
const PRIMARY_MODEL = 'google/gemini-2.0-flash-exp:free';
const FALLBACK_MODEL = 'openrouter/free';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://gefens-serenity.pages.dev',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function callOpenRouter(model, messages, apiKey) {
  return fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      // OpenRouter asks for these on free-tier requests for attribution/priority
      'HTTP-Referer': 'https://gefenrose.github.io',
      'X-Title': 'Serenity & Ofek'
    },
    body: JSON.stringify({ model, messages })
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin) });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400, headers: corsHeaders(origin) });
    }

    if (!body.system || !Array.isArray(body.messages)) {
      return new Response('Missing system or messages', { status: 400, headers: corsHeaders(origin) });
    }

    const messages = [
      { role: 'system', content: body.system },
      ...body.messages
    ];

    let upstream = await callOpenRouter(PRIMARY_MODEL, messages, env.OPENROUTER_API_KEY);

    // If the primary free model was retired/renamed upstream, fall back
    // to OpenRouter's auto-selecting free router rather than failing outright
    if (upstream.status === 400 || upstream.status === 404) {
      upstream = await callOpenRouter(FALLBACK_MODEL, messages, env.OPENROUTER_API_KEY);
    }

    if (!upstream.ok) {
      const errText = await upstream.text();
      return new Response(errText, {
        status: upstream.status,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
      });
    }

    const data = await upstream.json();
    const rawContent = data.choices?.[0]?.message?.content;
    let text = '';
    if (typeof rawContent === 'string') {
      text = rawContent;
    } else if (Array.isArray(rawContent)) {
      // Some providers (incl. some Gemini routes on OpenRouter) return
      // content as an array of parts rather than a plain string - join
      // just the text parts instead of letting it get stringified raw.
      text = rawContent.map(p => (typeof p === 'string' ? p : p?.text || '')).join('');
    }

    return new Response(JSON.stringify({ content: [{ text }] }), {
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
    });
  }
};
