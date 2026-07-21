import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/worker.js';

const APP_ORIGIN = 'https://gefenrose.github.io';

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
