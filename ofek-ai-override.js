// Runtime patch for Ofek AI routing.
//
// This file is injected by sw.js so we can add stable AI routing without
// rewriting the large single-file app. It:
// 1. Redirects the old serenity-api endpoint to the dedicated Ofek Worker.
// 2. Adds a bring-your-own-key AI panel to Settings.
// 3. Sends user API keys only per request; keys are stored locally on this device.
// 4. Fixes long settings sheets so they can scroll on mobile.

(function(){
  'use strict';

  var LEGACY_ENDPOINT = 'https://serenity-api.gefenrose.workers.dev';
  var OFEK_ENDPOINT = 'https://ofek-api.gefenrose.workers.dev';
  var SETTINGS_KEY = 'ofek_ai_settings_v1';
  var STATE_KEY = 'ofek_state_v1';

  var DEFAULTS = {
    mode: 'byok',
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    apiKey: ''
  };

  var DEFAULT_MODELS = {
    groq: 'llama-3.3-70b-versatile',
    openai: 'gpt-4.1-mini',
    openrouter: 'meta-llama/llama-3.1-8b-instruct'
  };

  function readAppLang(){
    try{
      var state = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
      return (state.profile && state.profile.lang) || document.documentElement.lang || 'he';
    }catch(e){
      return document.documentElement.lang || 'he';
    }
  }

  function text(){
    var he = readAppLang() !== 'en';
    return he ? {
      title: 'חיבור AI',
      subtitle: 'אופק משתמש רק במפתח API שהמשתמש/ת מזינ/ה ידנית. אין מפתח Groq מובנה באפליקציה.',
      provider: 'ספק',
      model: 'מודל',
      key: 'מפתח API',
      keyPlaceholder: 'נשמר רק על המכשיר הזה',
      note: 'המפתח נשמר בדפדפן המקומי ונשלח רק לבקשות AI דרך ה־Worker של אופק. לא להשתמש במכשיר משותף.',
      save: 'שמירה',
      test: 'בדיקת חיבור',
      saved: 'נשמר',
      testing: 'בודקת…',
      ok: 'החיבור עובד',
      missingKey: 'צריך להזין מפתח API',
      failed: 'הבדיקה נכשלה'
    } : {
      title: 'AI connection',
      subtitle: 'Ofek only uses an API key entered manually by the user. There is no built-in Groq key in the app.',
      provider: 'Provider',
      model: 'Model',
      key: 'API key',
      keyPlaceholder: 'Saved only on this device',
      note: 'The key is saved in this browser and sent only for AI requests through the Ofek Worker. Do not use this on a shared device.',
      save: 'Save',
      test: 'Test connection',
      saved: 'Saved',
      testing: 'Testing…',
      ok: 'Connection works',
      missingKey: 'Enter an API key first',
      failed: 'Connection test failed'
    };
  }

  function readSettings(){
    try{
      var saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return Object.assign({}, DEFAULTS, saved || {}, { mode: 'byok' });
    }catch(e){
      return Object.assign({}, DEFAULTS);
    }
  }

  function saveSettings(settings){
    var clean = Object.assign({}, DEFAULTS, settings || {});
    clean.mode = 'byok';
    clean.provider = DEFAULT_MODELS[clean.provider] ? clean.provider : 'groq';
    clean.model = String(clean.model || DEFAULT_MODELS[clean.provider] || DEFAULTS.model).trim();
    clean.apiKey = String(clean.apiKey || '').trim();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean));
    window.dispatchEvent(new CustomEvent('ofek-ai-settings-change', { detail: { mode: clean.mode, provider: clean.provider, model: clean.model } }));
    return clean;
  }

  function headersToObject(headers){
    var out = {};
    if(!headers) return out;
    if(headers instanceof Headers){
      headers.forEach(function(value, key){ out[key] = value; });
      return out;
    }
    return Object.assign({}, headers);
  }

  function safeJsonParse(value){
    try{ return JSON.parse(value || '{}'); }catch(e){ return {}; }
  }

  var originalFetch = window.fetch ? window.fetch.bind(window) : null;
  if(originalFetch && !window.__ofekAiFetchPatched){
    window.__ofekAiFetchPatched = true;
    window.fetch = function(input, init){
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if(url.indexOf(LEGACY_ENDPOINT) !== -1){
        return routeAiRequest(init || {});
      }
      return originalFetch(input, init);
    };
  }

  function routeAiRequest(init){
    var settings = readSettings();
    var body = safeJsonParse(init.body);
    var headers = headersToObject(init.headers);
    headers['Content-Type'] = 'application/json';

    body.ai = {
      mode: 'byok',
      provider: settings.provider,
      model: settings.model || DEFAULT_MODELS[settings.provider],
      apiKey: settings.apiKey
    };

    return originalFetch(OFEK_ENDPOINT, {
      method: init.method || 'POST',
      headers: headers,
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store'
    });
  }

  function addStyle(){
    if(document.getElementById('ofek-ai-settings-style')) return;
    var style = document.createElement('style');
    style.id = 'ofek-ai-settings-style';
    style.textContent = [
      '.sheet{max-height:calc(100dvh - 18px)!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch!important;overscroll-behavior:contain!important;touch-action:pan-y!important;}',
      '.sheet.open{transform:translateY(0)!important;}',
      '.sheet h2{position:relative;}',
      '.ofek-ai-card{padding:13px 14px;border:1px solid var(--line);border-radius:14px;background:var(--paper-raised);}',
      '.ofek-ai-title{font-weight:700;margin-bottom:5px;}',
      '.ofek-ai-subtitle{font-size:.82rem;line-height:1.45;color:var(--ink-soft);margin-bottom:12px;}',
      '.ofek-ai-grid{display:grid;gap:10px;margin-top:10px;}',
      '.ofek-ai-row label{font-size:.78rem;color:var(--ink-soft);display:block;margin-bottom:5px;}',
      '.ofek-ai-row input,.ofek-ai-row select{width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--paper);color:var(--ink);font:inherit;}',
      '.ofek-ai-note{font-size:.78rem;line-height:1.45;color:var(--ink-faint);margin:10px 0 0;}',
      '.ofek-ai-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}',
      '.ofek-ai-status{font-size:.8rem;color:var(--ink-soft);align-self:center;}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function providerOptions(current){
    return ['groq','openai','openrouter'].map(function(name){
      return '<option value="'+name+'"'+(current===name?' selected':'')+'>'+name+'</option>';
    }).join('');
  }

  function injectSettingsPanel(){
    addStyle();
    if(document.getElementById('ofek-ai-settings-field')) return;
    var sheet = document.getElementById('settings-sheet');
    if(!sheet) return;

    var labels = text();
    var settings = readSettings();
    var field = document.createElement('div');
    field.className = 'field';
    field.id = 'ofek-ai-settings-field';
    field.innerHTML = ''+
      '<div class="ofek-ai-card">'+
        '<div class="ofek-ai-title">'+labels.title+'</div>'+
        '<div class="ofek-ai-subtitle">'+labels.subtitle+'</div>'+
        '<div class="ofek-ai-grid" id="ofek-ai-byok-fields">'+
          '<div class="ofek-ai-row"><label>'+labels.provider+'</label><select id="ofek-ai-provider">'+providerOptions(settings.provider)+'</select></div>'+
          '<div class="ofek-ai-row"><label>'+labels.model+'</label><input id="ofek-ai-model" type="text" value="'+escapeAttr(settings.model || DEFAULT_MODELS[settings.provider])+'"></div>'+
          '<div class="ofek-ai-row"><label>'+labels.key+'</label><input id="ofek-ai-key" type="password" autocomplete="off" placeholder="'+escapeAttr(labels.keyPlaceholder)+'" value="'+escapeAttr(settings.apiKey)+'"></div>'+
        '</div>'+
        '<p class="ofek-ai-note">'+labels.note+'</p>'+
        '<div class="ofek-ai-actions">'+
          '<button type="button" class="data-btn" id="ofek-ai-save-btn">'+labels.save+'</button>'+
          '<button type="button" class="data-btn" id="ofek-ai-test-btn">'+labels.test+'</button>'+
          '<span class="ofek-ai-status" id="ofek-ai-status"></span>'+
        '</div>'+
      '</div>';

    var driveField = document.getElementById('drive-sync-label');
    var anchor = driveField && driveField.closest ? driveField.closest('.field') : null;
    if(anchor && anchor.parentNode){
      anchor.parentNode.insertBefore(field, anchor.nextSibling);
    } else {
      var closeBtn = document.getElementById('sheet-close-btn');
      sheet.insertBefore(field, closeBtn || null);
    }

    bindSettingsPanel();
  }

  function escapeAttr(value){
    return String(value || '').replace(/[&<>"]/g, function(ch){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]);
    });
  }

  function bindSettingsPanel(){
    var labels = text();
    var provider = document.getElementById('ofek-ai-provider');
    var model = document.getElementById('ofek-ai-model');
    var key = document.getElementById('ofek-ai-key');
    var saveBtn = document.getElementById('ofek-ai-save-btn');
    var testBtn = document.getElementById('ofek-ai-test-btn');
    var status = document.getElementById('ofek-ai-status');

    function setStatus(message){
      if(status) status.textContent = message || '';
    }

    function collect(){
      return saveSettings({
        mode: 'byok',
        provider: provider ? provider.value : 'groq',
        model: model ? model.value : '',
        apiKey: key ? key.value : ''
      });
    }

    if(provider){
      provider.addEventListener('change', function(){
        if(model && (!model.value || Object.keys(DEFAULT_MODELS).some(function(p){ return p !== provider.value && DEFAULT_MODELS[p] === model.value; }))){
          model.value = DEFAULT_MODELS[provider.value] || '';
        }
      });
    }
    if(saveBtn){
      saveBtn.addEventListener('click', function(){ collect(); setStatus(labels.saved); setTimeout(function(){ setStatus(''); }, 2200); });
    }
    if(testBtn){
      testBtn.addEventListener('click', function(){ testConnection(collect(), labels, setStatus); });
    }
  }

  async function testConnection(settings, labels, setStatus){
    setStatus(labels.testing);
    try{
      if(!settings.apiKey){
        setStatus(labels.missingKey);
        return;
      }
      var body = {
        system: 'Reply with OK only.',
        messages: [{ role: 'user', content: 'Connection test' }],
        max_tokens: 20,
        ai: { mode:'byok', provider:settings.provider, model:settings.model, apiKey:settings.apiKey }
      };
      var res = await originalFetch(OFEK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        credentials: 'omit'
      });
      if(!res.ok) throw new Error(await res.text());
      setStatus(labels.ok);
    }catch(e){
      setStatus(labels.failed);
      console.warn('[Ofek AI] connection test failed', e);
    }
  }

  function boot(){
    addStyle();
    injectSettingsPanel();
    var obs = new MutationObserver(function(){ injectSettingsPanel(); });
    if(document.body) obs.observe(document.body, { childList:true, subtree:true });
    setInterval(injectSettingsPanel, 2500);
    console.info('[Ofek AI] BYOK-only routing through', OFEK_ENDPOINT);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();
