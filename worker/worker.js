// Ofek companion API — proxies chat requests to Gemini 2.5 Flash via its
// OpenAI-compatible endpoint, and replies in an Anthropic-Messages-shaped
// body so the client code stays simple.
//
// Request:  POST { system?: string, messages: [{role:'user'|'assistant', content:string}], max_tokens?: number }
// Response: { content: [{ type:'text', text: string }] }
//
// Setup:
//   1. wrangler secret put GEMINI_API_KEY
//   2. wrangler deploy
//
// You only need this if you'd rather give Ofek its own backend instead of
// reusing the existing serenity-api worker (which already speaks this same
// shape). If you reuse serenity-api, you can ignore this file — just make
// sure AI_ENDPOINT in index.html points at it.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const system = body.system;
    const messages = body.messages || [];
    const maxTokens = body.max_tokens || 300;

    const oaMessages = [];
    if (system) oaMessages.push({ role: 'system', content: system });
    for (const m of messages) {
      oaMessages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
    }

    try {
      const upstream = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.GEMINI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gemini-2.5-flash',
            messages: oaMessages,
            max_tokens: maxTokens,
          }),
        }
      );

      const data = await upstream.json();
      const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      return json({ content: [{ type: 'text', text }] });
    } catch (err) {
      return json({ error: 'Upstream request failed' }, 502);
    }
  },
};
