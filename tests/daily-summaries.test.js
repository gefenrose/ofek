import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('daily summaries send every entry and cache the combined result', async () => {
  const source = await readFile(path.join(root, 'src/js/daily-summaries.js'), 'utf8');
  const context = { window:{} };
  vm.runInNewContext(source, context);

  const state = {
    profile:{ lang:'en' },
    entries:[
      { id:'one', date:'2026-07-21', time:'09:00', flow:'chat', note:'Finished an important task.' },
      { id:'two', date:'2026-07-21', time:'18:00', flow:'mood', mood:8, note:'Stopped to breathe and rest.' }
    ],
    daySummaries:{}
  };
  let request;
  let saves = 0;
  const manager = context.window.OfekDailySummaries.create({
    getState:() => state,
    saveState:() => { saves += 1; },
    askCompanion:async (system, messages) => {
      request = { system, messages };
      return 'I made progress and also gave myself room to pause and rest.';
    },
    moodLabels:{ en:['low','one','two','three','four','five','six','okay','calm'] },
    flowLabel:(flow) => flow,
    formatDate:(date) => date,
    onUpdated:() => {}
  });

  const initial = manager.get('2026-07-21', state.entries);
  assert.equal(initial.status, 'loading');
  assert.match(initial.text, /Finished an important task/);
  assert.match(initial.text, /Stopped to breathe and rest/);

  await new Promise((resolve) => setImmediate(resolve));
  const ready = manager.get('2026-07-21', state.entries);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.text, 'I made progress and also gave myself room to pause and rest.');
  assert.match(request.messages[0].content, /Finished an important task/);
  assert.match(request.messages[0].content, /Stopped to breathe and rest/);
  assert.equal(saves, 1);
});
