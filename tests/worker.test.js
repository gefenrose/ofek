import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/worker.js';

const APP_ORIGIN = 'https://gefenrose.github.io';
const VERCEL_ORIGIN = 'https://ofek-horizon.vercel.app';

function post(body, origin = APP_ORIGIN, extraHeaders = {}) {
  return new Request('https://ofek-api.example.test/', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Origin:origin, ...extraHeaders },
    body:JSON.stringify(body)
  });
}

test('health response declares BYOK-only mode', async () => {
  const response = await worker.fetch(new Request('https://ofek-api.example.test/', {
    headers:{ Origin:APP_ORIGIN }
  }), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, 'bring-your-own-key-only');
  assert.equal(body.hasAppOwnedApiKey, false);
  assert.equal(body.providers.anthropic.defaultModel, 'claude-sonnet-5');
  assert.equal(body.providers.groq.defaultModel, 'openai/gpt-oss-120b');
});

test('rejects disallowed origins before processing a request', async () => {
  const response = await worker.fetch(post({ system:'x', messages:[] }, 'https://attacker.example'), {});
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});

test('allows localhost development ports without weakening other origins', async () => {
  const response = await worker.fetch(post({ system:'x', messages:[] }, 'http://localhost:4173'), {});
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://localhost:4173');
});

test('allows the Ofek Vercel production origin', async () => {
  const response = await worker.fetch(post({ system:'x', messages:[] }, VERCEL_ORIGIN), {});
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), VERCEL_ORIGIN);
});

test('rejects unknown providers instead of silently falling back', async () => {
  const response = await worker.fetch(post({
    system:'x', messages:[], ai:{ provider:'unknown', apiKey:'secret' }
  }), {});
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error:'Unsupported AI provider' });
});

test('rejects oversized bodies', async () => {
  const request = post({ system:'x', messages:[] }, APP_ORIGIN, { 'Content-Length':'300000' });
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 413);
});

test('forwards a valid request and never returns the user key', async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, init) => {
    forwarded = { url, init, body:JSON.parse(init.body) };
    return new Response(JSON.stringify({ choices:[{ message:{ content:'OK' } }] }), {
      status:200,
      headers:{ 'Content-Type':'application/json' }
    });
  };
  try {
    const response = await worker.fetch(post({
      system:'Reply briefly',
      messages:[{ role:'user', content:'Hello' }],
      ai:{ provider:'openai', model:'gpt-4.1-mini', apiKey:'user-secret' }
    }), {});
    assert.equal(response.status, 200);
    assert.equal(forwarded.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(forwarded.init.headers.Authorization, 'Bearer user-secret');
    assert.equal(forwarded.body.messages[0].role, 'system');
    const body = await response.json();
    assert.equal(body.content[0].text, 'OK');
    assert.equal(JSON.stringify(body).includes('user-secret'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('adapts Anthropic requests and responses to the shared contract', async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, init) => {
    forwarded = { url, init, body:JSON.parse(init.body) };
    return new Response(JSON.stringify({
      content:[
        { type:'text', text:'Hello ' },
        { type:'text', text:'from Claude' }
      ]
    }), {
      status:200,
      headers:{ 'Content-Type':'application/json' }
    });
  };
  try {
    const response = await worker.fetch(post({
      system:'Reply briefly',
      messages:[{ role:'user', content:'Hello' }],
      ai:{ provider:'anthropic', apiKey:'anthropic-secret' }
    }), {});
    assert.equal(response.status, 200);
    assert.equal(forwarded.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(forwarded.init.headers['x-api-key'], 'anthropic-secret');
    assert.equal(forwarded.init.headers['anthropic-version'], '2023-06-01');
    assert.equal(forwarded.init.headers.Authorization, undefined);
    assert.equal(forwarded.body.model, 'claude-sonnet-5');
    assert.equal(forwarded.body.system, 'Reply briefly');
    assert.deepEqual(forwarded.body.messages, [{ role:'user', content:'Hello' }]);
    assert.equal(forwarded.body.temperature, undefined);
    const body = await response.json();
    assert.equal(body.content[0].text, 'Hello from Claude');
    assert.equal(body.provider, 'anthropic');
    assert.equal(JSON.stringify(body).includes('anthropic-secret'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('migrates old Groq default models when forwarding requests', async () => {
  const originalFetch = globalThis.fetch;
  const forwardedModels = [];
  globalThis.fetch = async (url, init) => {
    forwardedModels.push(JSON.parse(init.body).model);
    return new Response(JSON.stringify({ choices:[{ message:{ content:'OK' } }] }), {
      status:200, headers:{ 'Content-Type':'application/json' }
    });
  };
  try {
    for (const ai of [
      { provider:'groq', apiKey:'test-key' },
      { provider:'groq', model:'llama-3.3-70b-versatile', apiKey:'test-key' }
    ]) {
      const response = await worker.fetch(post({
        system:'Reply briefly', messages:[{ role:'user', content:'Hello' }], ai
      }), {});
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.model, 'openai/gpt-oss-120b');
    }
    assert.deepEqual(forwardedModels, ['openai/gpt-oss-120b', 'openai/gpt-oss-120b']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
