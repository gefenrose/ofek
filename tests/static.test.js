import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('index loads direct modules with a strict script policy', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.equal(html.includes('bootstrap.js'), false);
  assert.equal(html.includes('legacy/monolith.html'), false);
  assert.equal(html.includes("script-src 'self' 'unsafe-inline'"), false);
  assert.match(html, /src="assets\/icons\/icon-192\.png"/);
  assert.equal(/src="icon-192\.png"/.test(html), false);
  assert.match(html, /id="settings-sheet" aria-hidden="true" inert/);
  assert.match(html, /for="ob-name"/);
  for (const moduleName of ['i18n', 'image-utils', 'cloud-sync', 'screen-lock', 'data-transfer', 'daily-summaries']) {
    assert.match(html, new RegExp(`src/js/${moduleName}\\.js`));
  }
});

test('every precached service-worker asset exists', async () => {
  const source = await readFile(path.join(root, 'sw.js'), 'utf8');
  const match = source.match(/const CORE_ASSETS = \[([\s\S]*?)\];/);
  assert.ok(match);
  const assets = [...match[1].matchAll(/'\.\/(.*?)'/g)].map((item) => item[1]);
  assert.ok(assets.length >= 10);
  await Promise.all(assets.map((asset) => access(path.join(root, asset))));
  assert.equal(source.includes('cached || appShellResponse(request)'), false);
  assert.match(source, /if\(response\.ok\) await cache\.put\(request/);
});

test('journal persistence is IndexedDB-backed and reports failures', async () => {
  const source = await readFile(path.join(root, 'src/js/storage.js'), 'utf8');
  assert.match(source, /indexedDB\.open/);
  assert.match(source, /ofek-storage-error/);
  const app = await readFile(path.join(root, 'src/js/app.js'), 'utf8');
  assert.equal(app.includes("localStorage.setItem(STORAGE_KEY"), false);
  assert.match(app, /await window\.OfekStorage\.load\(\)/);
});

test('feature domains expose narrow module APIs', async () => {
  const expectations = {
    'cloud-sync.js':'window.OfekCloudSync = { create:create }',
    'screen-lock.js':'window.OfekScreenLock = { create:create }',
    'data-transfer.js':'window.OfekDataTransfer = { bind:bind }',
    'image-utils.js':'window.OfekImages = { readAndCompress:readAndCompress }',
    'daily-summaries.js':'window.OfekDailySummaries = { create:create }',
    'i18n.js':'window.OfekI18n = {'
  };
  for (const [file, marker] of Object.entries(expectations)) {
    const source = await readFile(path.join(root, 'src/js', file), 'utf8');
    assert.ok(source.includes(marker), `${file} should expose its documented API`);
  }
});

test('history renders one expandable whole-day summary card', async () => {
  const app = await readFile(path.join(root, 'src/js/app.js'), 'utf8');
  assert.match(app, /dailySummaries\.get\(date, dayEntries\)/);
  assert.match(app, /head\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(app, /body\.hidden = true/);
  assert.match(app, /document\.createElement\('button'\); cell\.type = 'button'; cell\.className = 'cal-cell'/);
  assert.match(app, /message\.text \|\| message\.content/);

  const summaries = await readFile(path.join(root, 'src/js/daily-summaries.js'), 'utf8');
  assert.match(summaries, /Use every supplied entry/);
  assert.match(summaries, /state\.daySummaries\[date\]/);
});

test('composer exposes clear save feedback and usable controls', async () => {
  const app = await readFile(path.join(root, 'src/js/app.js'), 'utf8');
  assert.match(app, /saveBtn\.disabled = true/);
  assert.match(app, /showEntrySavedToast\(true\)/);
  assert.match(app, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(app, /calendarExpanded = false/);
  assert.match(app, /main\.scrollTop = 0/);
});

test('habits provide starter actions, a today queue, undo, and accessible controls', async () => {
  const app = await readFile(path.join(root, 'src/js/app.js'), 'utf8');
  assert.match(app, /addSuggestedHabit\(template\)/);
  assert.match(app, /habitsProgressLabel/);
  assert.match(app, /appendHabitGroup\(list, translate\('habitsDueTitle'\)/);
  assert.match(app, /showHabitUndo\(habitId, wasChecked\)/);
  assert.match(app, /setAttribute\('aria-pressed', String\(checked\)\)/);
  assert.match(app, /habitAdvancedTitle/);
  assert.match(app, /document\.getElementById\('habit-save-btn'\)\.disabled/);
});

test('insights explain sufficiency, compare periods, and expose evidence links', async () => {
  const app = await readFile(path.join(root, 'src/js/app.js'), 'utf8');
  assert.match(app, /periodSummaryText\(summary\)/);
  assert.match(app, /previousPeriodRange\(insightsPeriod, range\)/);
  assert.match(app, /moodProgressEmpty/);
  assert.match(app, /openHistoryRange\(range, formatPeriodLabel/);
  assert.match(app, /corr\.doneDays/);
  assert.match(app, /translate\('previousPeriod'\)/);
  assert.match(app, /setAttribute\('aria-pressed', String\(insightsPeriod === p\)\)/);
});
