// Bring-your-own-key AI routing and settings.

(function(){
  'use strict';

  var OFEK_ENDPOINT = 'https://ofek-api.gefenrose.workers.dev';
  var SETTINGS_KEY = 'ofek_ai_settings_v1';
  var SESSION_KEY = 'ofek_ai_session_key_v1';
  var PREFS_KEY = 'ofek_prefs_v1';

  var DEFAULTS = {
    mode: 'byok',
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    apiKey: ''
  };

  var DEFAULT_MODELS = {
    groq: 'openai/gpt-oss-120b',
    openai: 'gpt-4.1-mini',
    openrouter: 'meta-llama/llama-3.1-8b-instruct',
    gemini: 'gemini-3.5-flash',
    anthropic: 'claude-sonnet-5'
  };

  var PROVIDER_ORDER = ['groq','openai','anthropic','openrouter','gemini'];
  var PROVIDER_LABELS = {
    groq: 'Groq',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    openrouter: 'OpenRouter',
    gemini: 'Gemini'
  };

  function readAppLang(){
    try{
      var prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      return prefs.lang || document.documentElement.lang || 'he';
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
      keyPlaceholder: 'המפתח נשמר להפעלה הנוכחית',
      note: 'ברירת המחדל היא שמירה עד סגירת הדפדפן. המפתח נשלח רק לבקשות AI דרך ה־Worker של אופק.',
      remember: 'לזכור את המפתח במכשיר הזה',
      forget: 'מחיקת המפתח',
      forgotten: 'המפתח נמחק',
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
      keyPlaceholder: 'Kept for this browser session',
      note: 'By default, the key is kept until the browser closes. It is sent only for AI requests through the Ofek Worker.',
      remember: 'Remember the key on this device',
      forget: 'Forget key',
      forgotten: 'Key removed',
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
      var persistentKey = String(saved.apiKey || '');
      var sessionKey = sessionStorage.getItem(SESSION_KEY) || '';
      var settings = Object.assign({}, DEFAULTS, saved || {}, {
        mode: 'byok',
        apiKey: persistentKey || sessionKey,
        rememberKey: !!persistentKey
      });
      if(settings.provider === 'groq' && settings.model === 'llama-3.3-70b-versatile'){
        settings.model = DEFAULT_MODELS.groq;
      }
      return settings;
    }catch(e){
      return Object.assign({}, DEFAULTS);
    }
  }

  function saveSettings(settings){
    var clean = Object.assign({}, DEFAULTS, settings || {});
    clean.mode = 'byok';
    clean.provider = DEFAULT_MODELS[clean.provider] ? clean.provider : 'groq';
    clean.model = String(clean.model || DEFAULT_MODELS[clean.provider] || DEFAULTS.model).trim();
    if(clean.provider === 'groq' && clean.model === 'llama-3.3-70b-versatile'){
      clean.model = DEFAULT_MODELS.groq;
    }
    clean.apiKey = String(clean.apiKey || '').trim();
    clean.rememberKey = !!clean.rememberKey;
    var persisted = { mode:clean.mode, provider:clean.provider, model:clean.model };
    if(clean.rememberKey && clean.apiKey){
      persisted.apiKey = clean.apiKey;
      sessionStorage.removeItem(SESSION_KEY);
    } else {
      if(clean.apiKey) sessionStorage.setItem(SESSION_KEY, clean.apiKey);
      else sessionStorage.removeItem(SESSION_KEY);
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(persisted));
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

  var originalFetch = window.fetch.bind(window);

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

  window.OfekAI = { request:routeAiRequest, readSettings:readSettings };

  function providerOptions(current){
    return PROVIDER_ORDER.map(function(name){
      return '<option value="'+name+'"'+(current===name?' selected':'')+'>'+PROVIDER_LABELS[name]+'</option>';
    }).join('');
  }

  function injectSettingsPanel(){
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
          '<div class="ofek-ai-row"><label for="ofek-ai-provider">'+labels.provider+'</label><select id="ofek-ai-provider">'+providerOptions(settings.provider)+'</select></div>'+
          '<div class="ofek-ai-row"><label for="ofek-ai-model">'+labels.model+'</label><input id="ofek-ai-model" type="text" value="'+escapeAttr(settings.model || DEFAULT_MODELS[settings.provider])+'"></div>'+
          '<div class="ofek-ai-row"><label for="ofek-ai-key">'+labels.key+'</label><input id="ofek-ai-key" type="password" autocomplete="new-password" placeholder="'+escapeAttr(labels.keyPlaceholder)+'" value="'+escapeAttr(settings.apiKey)+'"></div>'+
          '<label class="ofek-ai-remember"><input id="ofek-ai-remember" type="checkbox"'+(settings.rememberKey?' checked':'')+'> <span>'+labels.remember+'</span></label>'+
        '</div>'+
        '<p class="ofek-ai-note">'+labels.note+'</p>'+
        '<div class="ofek-ai-actions">'+
          '<button type="button" class="data-btn" id="ofek-ai-save-btn">'+labels.save+'</button>'+
          '<button type="button" class="data-btn" id="ofek-ai-test-btn">'+labels.test+'</button>'+
          '<button type="button" class="data-btn" id="ofek-ai-forget-btn">'+labels.forget+'</button>'+
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
    var forgetBtn = document.getElementById('ofek-ai-forget-btn');
    var remember = document.getElementById('ofek-ai-remember');
    var status = document.getElementById('ofek-ai-status');

    function setStatus(message){
      if(status){
        status.textContent = message || '';
        status.title = message || '';
      }
    }

    function collect(){
      return saveSettings({
        mode: 'byok',
        provider: provider ? provider.value : 'groq',
        model: model ? model.value : '',
        apiKey: key ? key.value : '',
        rememberKey: remember ? remember.checked : false
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
    if(forgetBtn){
      forgetBtn.addEventListener('click', function(){
        localStorage.removeItem(SETTINGS_KEY);
        sessionStorage.removeItem(SESSION_KEY);
        if(key) key.value = '';
        if(remember) remember.checked = false;
        setStatus(labels.forgotten);
      });
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
        max_tokens: 20
      };
      var res = await routeAiRequest({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        credentials: 'omit'
      });
      if(!res.ok) throw await parseErrorResponse(res);
      setStatus(labels.ok);
    }catch(e){
      setStatus(formatConnectionError(e, labels));
      console.warn('[Ofek AI] connection test failed', e);
    }
  }

  async function parseErrorResponse(res){
    var text = await res.text();
    try{
      var json = JSON.parse(text || '{}');
      return {
        status: res.status,
        provider: json.provider,
        model: json.model,
        detail: json.detail || json.error || text
      };
    }catch(e){
      return { status: res.status, detail: text };
    }
  }

  function formatConnectionError(error, labels){
    var parts = [labels.failed];
    if(error && error.status) parts.push(String(error.status));
    if(error && error.provider) parts.push(String(error.provider));
    if(error && error.detail) parts.push(String(error.detail).replace(/\s+/g, ' ').slice(0, 160));
    return parts.join(' · ');
  }

  function boot(){
    injectSettingsPanel();
    console.info('[Ofek AI] BYOK-only routing through', OFEK_ENDPOINT);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();
