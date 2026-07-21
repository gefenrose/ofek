(function initializeSplash(){
  var splash = document.getElementById('splash-screen');
  if(!splash) return;
  setTimeout(function(){
    splash.classList.add('splash-hide');
    setTimeout(function(){ splash.style.display = 'none'; }, 650);
  }, 2700);
})();

(async function initializeApp(){
  'use strict';

  /* ============ Config ============ */
  var MOOD_STEPS = 15;
  var SVG_CHEVRON_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>';
  var SVG_CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>';

  var i18n = window.OfekI18n;
  var MOOD_LABELS = i18n.MOOD_LABELS;
  var WEEKDAYS = i18n.WEEKDAYS;
  var MONTHS = i18n.MONTHS;
  var STRINGS = i18n.STRINGS;
  var FLOW_KEY = i18n.FLOW_KEY;

  function translate(key, langOverride){
    var lang = langOverride || (state.profile && state.profile.lang) || 'he';
    return (STRINGS[lang] && STRINGS[lang][key] !== undefined) ? STRINGS[lang][key] : key;
  }
  function genderVariant(masculine, feminine, neutral){
    var gender = state.profile && state.profile.gender;
    if(gender === 'm') return masculine;
    if(gender === 'f') return feminine;
    return neutral !== undefined ? neutral : masculine + '/' + feminine;
  }

  function applyTheme(){
    var theme = state.theme || 'auto';
    document.documentElement.setAttribute('data-theme', theme);
    var isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme:dark)').matches);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', isDark ? '#1B1C22' : '#5B6B8C');
  }

  function renderSettingsThemeRow(){
    var row = document.getElementById('settings-theme-row');
    if(!row) return;
    row.innerHTML = '';
    var currentTheme = state.theme || 'auto';
    [['auto',translate('themeAuto')],['light',translate('themeLight')],['dark',translate('themeDark')]].forEach(function(pair){
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'pill' + (currentTheme === pair[0] ? ' active' : '');
      button.textContent = pair[1];
      button.addEventListener('click', function(){
        state.theme = pair[0];
        saveState();
        applyTheme();
        renderSettingsThemeRow();
      });
      row.appendChild(button);
    });
  }

  /* ============ State ============ */
  var state = await window.OfekStorage.load();
  if(!state.habits) state.habits = [];
  if(!state.daySummaries) state.daySummaries = {};
  if(!state.weeklyCache) state.weeklyCache = {};
  if(!state.security) state.security = { lockEnabled:false, pinHash:null, pinSalt:null, biometricEnabled:false, credentialId:null, credentialUserId:null };
  if(!state.theme) state.theme = 'auto';
  var screenLock = null;
  var cloudSync = { render:function(){}, schedule:function(){} };

  function saveState(){
    state.lastModified = Date.now();
    window.OfekStorage.save(state).catch(function(){ /* storage module presents an actionable error */ });
    cloudSync.schedule();
  }

  // Elapsed habits created by older versions only stored lastDoneAt. Seed that
  // date into completions so those habits can participate in Insights without
  // losing their existing history.
  (function migrateElapsedHabitHistory(){
    var changed = false;
    state.habits.forEach(function(habit){
      if(habit.trackMode !== 'elapsed' || !habit.lastDoneAt) return;
      habit.completions = habit.completions || [];
      var completionDate = todayStr(new Date(habit.lastDoneAt));
      if(habit.completions.indexOf(completionDate) === -1){
        habit.completions.push(completionDate);
        changed = true;
      }
    });
    if(changed) saveState();
  })();

  var toastTimer = null;
  function showToast(message, actionLabel, action){
    var previous = document.querySelector('.app-toast');
    if(previous) previous.remove();
    clearTimeout(toastTimer);
    var toast = document.createElement('div');
    toast.className = 'app-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    var text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);
    if(actionLabel && action){
      var actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.textContent = actionLabel;
      actionButton.addEventListener('click', function(){
        toast.remove();
        clearTimeout(toastTimer);
        action();
      });
      toast.appendChild(actionButton);
    }
    document.body.appendChild(toast);
    requestAnimationFrame(function(){ toast.classList.add('show'); });
    toastTimer = setTimeout(function(){ toast.remove(); }, 5000);
  }

  function showEntrySavedToast(withHistoryAction){
    showToast(
      translate('entrySaved'),
      withHistoryAction ? translate('viewHistory') : null,
      withHistoryAction ? function(){ switchToPanel('history'); } : null
    );
  }

  /* ============ Mood color (the horizon mapping) ============ */
  var MOOD_STOPS = [[0,[0x2E,0x31,0x48]],[0.45,[0x5B,0x6B,0x8C]],[0.70,[0x8F,0xB8,0xC9]],[1,[0xF4,0xC7,0x7B]]];
  function moodColor(value){
    var f = value/(MOOD_STEPS-1);
    for(var i=0;i<MOOD_STOPS.length-1;i++){
      var t0=MOOD_STOPS[i][0], c0=MOOD_STOPS[i][1], t1=MOOD_STOPS[i+1][0], c1=MOOD_STOPS[i+1][1];
      if(f>=t0 && f<=t1){
        var lt = t1>t0 ? (f-t0)/(t1-t0) : 0;
        var c = c0.map(function(v,idx){ return Math.round(v+(c1[idx]-v)*lt); });
        return 'rgb('+c[0]+','+c[1]+','+c[2]+')';
      }
    }
    var last = MOOD_STOPS[MOOD_STOPS.length-1][1];
    return 'rgb('+last[0]+','+last[1]+','+last[2]+')';
  }

  /* ============ Mood face icon ============ */
  function moodFaceSVG(index, color, size){
    size = size || 24;
    var steps = MOOD_STEPS - 1;
    var valence = (index/steps - 0.5) * 2; // -1 (lowest) .. 1 (highest)
    var cx = 12, cy = 12, r = 9;

    var mouthY = 15.5;
    var mouthHalfW = 3.6 + Math.abs(valence) * 1.2;
    var ctrlY = mouthY + valence * 6.4;
    var mouthPath = 'M'+(cx-mouthHalfW)+' '+mouthY+' Q'+cx+' '+ctrlY+' '+(cx+mouthHalfW)+' '+mouthY;

    var browDroop = Math.max(0, -valence) * 2.2;
    var browY = 8.3, browInset = 2.6, browSpan = 2.2;
    var leftBrow  = 'M'+(cx-browInset-browSpan)+' '+(browY+browDroop)+' L'+(cx-browInset)+' '+browY;
    var rightBrow = 'M'+(cx+browInset)+' '+browY+' L'+(cx+browInset+browSpan)+' '+(browY+browDroop);

    var eyeY = 10.2, eyeOffsetX = 3.6;
    var eyesSVG;
    if(index === 0){
      eyesSVG = '<path d="M'+(cx-eyeOffsetX-1.1)+' '+eyeY+' q1.1 1 2.2 0 M'+(cx+eyeOffsetX-1.1)+' '+eyeY+' q1.1 1 2.2 0" stroke="'+color+'" stroke-width="1.4" stroke-linecap="round" fill="none"/>';
    } else if(index >= steps - 2){
      eyesSVG = '<path d="M'+(cx-eyeOffsetX-1.3)+' '+(eyeY+0.5)+' q1.3 -1.5 2.6 0 M'+(cx+eyeOffsetX-1.3)+' '+(eyeY+0.5)+' q1.3 -1.5 2.6 0" stroke="'+color+'" stroke-width="1.4" stroke-linecap="round" fill="none"/>';
    } else {
      eyesSVG = '<circle cx="'+(cx-eyeOffsetX)+'" cy="'+eyeY+'" r="0.9" fill="'+color+'"/><circle cx="'+(cx+eyeOffsetX)+'" cy="'+eyeY+'" r="0.9" fill="'+color+'"/>';
    }

    return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:block;width:'+size+'px;height:'+size+'px;flex-shrink:0">'
      + '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" stroke="'+color+'" stroke-width="1.6"/>'
      + '<path d="'+leftBrow+'" stroke="'+color+'" stroke-width="1.5" stroke-linecap="round"/>'
      + '<path d="'+rightBrow+'" stroke="'+color+'" stroke-width="1.5" stroke-linecap="round"/>'
      + eyesSVG
      + '<path d="'+mouthPath+'" stroke="'+color+'" stroke-width="1.6" stroke-linecap="round" fill="none"/>'
      + '</svg>';
  }

  /* ============ Date helpers (hardcoded names — avoids toLocaleDateString quirks) ============ */
  function pad(n){ return String(n).padStart(2,'0'); }
  function todayStr(d){ d=d||new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function timeStr(d){ d=d||new Date(); return pad(d.getHours())+':'+pad(d.getMinutes()); }
  function dayPart(h){
    if(h>=5 && h<12) return 'morning';
    if(h>=12 && h<17) return 'afternoon';
    if(h>=17 && h<21) return 'evening';
    return 'night';
  }
  function formatDate(dateStr){
    var lang = (state.profile && state.profile.lang) || 'he';
    var parts = dateStr.split('-').map(Number);
    var dt = new Date(parts[0], parts[1]-1, parts[2]);
    var wd = WEEKDAYS[lang][dt.getDay()];
    var mo = MONTHS[lang][parts[1]-1];
    return lang==='he' ? (wd+', '+parts[2]+' ב'+mo) : (wd+', '+mo+' '+parts[2]);
  }
  function lastNDays(n){
    var out=[], d=new Date();
    for(var i=0;i<n;i++){ out.push(todayStr(d)); d.setDate(d.getDate()-1); }
    return out;
  }

  /* ============ Onboarding ============ */
  var obLang = 'he';
  var obGender = null;

  function renderOnboarding(){
    document.documentElement.lang = obLang;
    document.documentElement.dir = obLang==='he' ? 'rtl' : 'ltr';
    document.getElementById('ob-title').textContent = translate('onboardTitle', obLang);
    document.getElementById('ob-sub').textContent = translate('onboardSub', obLang);
    document.getElementById('ob-name-label').textContent = translate('nameLabel', obLang);
    document.getElementById('ob-name').placeholder = translate('namePh', obLang);
    document.getElementById('ob-gender-label').textContent = translate('genderLabel', obLang);
    document.getElementById('ob-lang-label').textContent = translate('langLabel', obLang);
    document.getElementById('ob-continue').textContent = translate('continueBtn', obLang);

    var genderRow = document.getElementById('ob-gender-row');
    genderRow.innerHTML = '';
    [['m', translate('genderM',obLang)], ['f', translate('genderF',obLang)], ['x', translate('genderX',obLang)]].forEach(function(pair){
      var b = document.createElement('button');
      b.type='button'; b.className='pill'+(obGender===pair[0]?' active':'');
      b.textContent = pair[1];
      b.addEventListener('click', function(){ obGender = pair[0]; renderOnboarding(); validateOnboard(); });
      genderRow.appendChild(b);
    });

    var langRow = document.getElementById('ob-lang-row');
    langRow.innerHTML = '';
    [['he','עברית'],['en','English']].forEach(function(pair){
      var b = document.createElement('button');
      b.type='button'; b.className='pill'+(obLang===pair[0]?' active':'');
      b.textContent = pair[1];
      b.addEventListener('click', function(){ obLang = pair[0]; renderOnboarding(); });
      langRow.appendChild(b);
    });
  }

  function validateOnboard(){
    var name = document.getElementById('ob-name').value.trim();
    document.getElementById('ob-continue').disabled = !(name && obGender);
  }
  document.getElementById('ob-name').addEventListener('input', validateOnboard);

  document.getElementById('ob-continue').addEventListener('click', function(){
    var name = document.getElementById('ob-name').value.trim();
    if(!name || !obGender) return;
    state.profile = { name: name, gender: obGender, lang: obLang, onboarded: true };
    saveState();
    document.getElementById('onboarding').style.display = 'none';
    startApp();
  });

  /* ============ App init ============ */
  function startApp(){
    applyTheme();
    applyLangDir();
    document.getElementById('app').classList.add('live');
    initDistressCard();
    renderStaticLabels();
    renderGreeting();
    updateRibbon();
    renderHistory();
    renderInsights();
    renderHabits();
    checkHabitNotifications();
    registerSW();
    document.getElementById('settings-name').value = state.profile.name;
    renderSettingsLangRow();
    highlightLangToggle();
    // Auto-open "Just Talk" so the user lands in conversation immediately.
    // A small delay lets the panel animate in first.
    setTimeout(function(){ openFlow('chat'); }, 60);
  }

  function applyLangDir(){
    var lang = state.profile.lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang==='he' ? 'rtl' : 'ltr';
  }

  function renderStaticLabels(){
    var brandText = state.profile.lang==='he' ? 'אופק' : 'Ofek';
    document.querySelectorAll('.brand-text').forEach(function(el){ el.textContent = brandText; });
    document.querySelectorAll('[data-nav="chat"]').forEach(function(el){ el.textContent = translate('navChat'); });
    document.querySelectorAll('[data-nav="history"]').forEach(function(el){ el.textContent = translate('navHistory'); });
    document.querySelectorAll('[data-nav="insights"]').forEach(function(el){ el.textContent = translate('navInsights'); });
    document.querySelectorAll('[data-nav="habits"]').forEach(function(el){ el.textContent = translate('navHabits'); });
    document.getElementById('distress-text').innerHTML = translate('distressText')+' <a href="tel:1201">1201</a>';
    document.getElementById('settings-title').textContent = translate('settingsTitle');
    document.getElementById('settings-name-label').textContent = translate('settingsName');
    document.getElementById('settings-lang-label').textContent = translate('settingsLang');
    document.getElementById('settings-theme-label').textContent = translate('settingsTheme');
    renderSettingsThemeRow();
    document.getElementById('drive-sync-label').textContent = translate('driveSyncLabel');
    document.getElementById('drive-connect-label').textContent = translate('driveConnect');
    document.getElementById('drive-sync-now-btn').textContent = translate('driveSyncNow');
    document.getElementById('drive-disconnect-btn').textContent = translate('driveDisconnect');
    if(typeof renderDriveStatus === 'function') renderDriveStatus();
    document.getElementById('export-data-btn').textContent = translate('exportData');
    document.getElementById('import-data-btn').textContent = translate('importData');
    document.getElementById('clear-data-btn').textContent = translate('clearData');
    document.getElementById('sheet-close-btn').textContent = translate('close');
    var sidenavSettingsLabel = document.getElementById('sidenav-settings-label');
    if(sidenavSettingsLabel) sidenavSettingsLabel.textContent = translate('settingsTitle');
    document.getElementById('settings-credit-text').textContent = translate('credit');
    document.getElementById('grounding-btn-label').textContent = translate('flowGrounding');
    document.getElementById('grounding-disclaimer-title').textContent = translate('groundingDisclaimerTitle');
    document.getElementById('grounding-disclaimer-text').textContent = translate('groundingDisclaimerText');
    document.getElementById('grounding-continue-btn').textContent = translate('groundingContinue');
    document.getElementById('grounding-cancel-btn').textContent = translate('groundingCancel');
    cloudSync.render();
  }

  function renderGreeting(){
    var part = dayPart(new Date().getHours());
    var map = { morning:'greetMorning', afternoon:'greetAfternoon', evening:'greetEvening', night:'greetNight' };
    document.getElementById('greeting-text').textContent = translate(map[part]) + (state.profile.name ? ', '+state.profile.name : '');
    document.getElementById('greeting-sub').textContent = formatDate(todayStr());
  }

  /* ============ Chat / flows ============ */
  var currentFlow = null;
  var activeEntryId = null;
  var backfillDate = null; // when set, the active entry is being logged for a past date, not today
  var composerMoodEnabled = false;
  var composerPickedImage = null;

  function resetDistressCard(){
    var card = document.getElementById('distress-card');
    if(!card) return;
    // Don't re-show if user dismissed in this session
    if(isDistressDismissed()){
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    card.style.maxHeight = '';
    card.style.opacity = '';
    card.style.marginTop = ''; card.style.marginBottom = '';
    card.style.paddingTop = ''; card.style.paddingBottom = '';
    card.style.borderColor = '';
  }
  var DISTRESS_DISMISS_KEY = 'ofek_distress_dismissed_v1';
  function isDistressDismissed(){
    try { return sessionStorage.getItem(DISTRESS_DISMISS_KEY) === '1'; }
    catch(e){ return false; }
  }
  function dismissDistressCard(){
    var card = document.getElementById('distress-card');
    if(!card) return;
    card.style.maxHeight = card.scrollHeight + 'px';
    requestAnimationFrame(function(){
      card.style.maxHeight = '0px';
      card.style.opacity = '0';
      card.style.marginTop = '0px'; card.style.marginBottom = '0px';
      card.style.paddingTop = '0px'; card.style.paddingBottom = '0px';
      card.style.borderColor = 'transparent';
    });
    setTimeout(function(){ card.style.display = 'none'; }, 320);
    try { sessionStorage.setItem(DISTRESS_DISMISS_KEY, '1'); } catch(e){}
  }
  function initDistressCard(){
    var card = document.getElementById('distress-card');
    if(!card) return;
    if(isDistressDismissed()){
      card.style.display = 'none';
    } else {
      card.style.display = '';
    }
  }
  var distressCloseBtn = document.getElementById('distress-close');
  if(distressCloseBtn){
    distressCloseBtn.addEventListener('click', dismissDistressCard);
  }

  function openFlow(flow, dateKey){
    currentFlow = flow;
    activeEntryId = 'e'+Date.now();
    backfillDate = dateKey || null;
    composerMoodEnabled = (flow === 'mood');
    composerPickedImage = null;
    resetDistressCard();
    if(backfillDate) switchToPanel('chat');
    if(flow === 'grounding'){
      renderGroundingChat();
    } else {
      renderComposer(flow);
    }
  }

  function recentEntriesDigest(){
    var lang = state.profile.lang;
    var cutoff = Date.now() - 30*24*60*60*1000; // last 30 days
    var candidates = state.entries.filter(function(e){
      return e.id !== activeEntryId && (e.createdAt||0) >= cutoff;
    }).sort(function(a,b){ return (b.createdAt||0) - (a.createdAt||0); });
    var picked = candidates.slice(0, 12);
    if(!picked.length) return '';
    var lines = picked.map(function(e){
      var text = e.summary
        || (typeof e.mood === 'number' ? MOOD_LABELS[lang][e.mood] + (e.note ? ' — '+e.note : '') : null)
        || (e.messages && e.messages[0] && e.messages[0].text)
        || e.note;
      if(!text) return null;
      return formatDate(e.date) + ': ' + text;
    }).filter(Boolean);
    return lines.join('\n');
  }

  function genderAddressNote(){
    var lang = state.profile.lang;
    var g = state.profile.gender;
    if(lang === 'he'){
      if(g === 'm') return ' פנה אל המשתמש בלשון זכר יחיד בלבד (אתה, הולך, מרגיש וכו׳) — לא בלשון נקבה ולא בצורות מקוצרות עם לוכסן (כמו את/ה).';
      if(g === 'f') return ' פני אל המשתמשת בלשון נקבה יחיד בלבד (את, הולכת, מרגישה וכו׳) — לא בלשון זכר ולא בצורות מקוצרות עם לוכסן (כמו את/ה).';
      return ' פנה/י אל המשתמש/ת בצורות ניטרליות — עדיפות לנסח בלי פנייה מגדרית ישירה, להשתמש בשם בלבד, או בצורות עם לוכסן (את/ה, הולך/ת). אל תפנה/י בצורה חד-מגדרית בלבד.';
    }
    if(g === 'm') return ' Address the user using he/him pronouns.';
    if(g === 'f') return ' Address the user using she/her pronouns.';
    return ' Use gender-neutral language when addressing the user.';
  }

  function buildPromptSystemMessage(flow){
    var lang = state.profile.lang;
    var name = state.profile.name;
    var base = (lang==='he'
      ? ('את/ה עוזר/ת כתיבה עדינה ליומן אישי בשם '+name+'. התפקיד שלך הוא להציע הצעת כתיבה אחת קצרה וחמה שתעזור לפתוח את הכתיבה. משפט או שניים בלבד, פנייה ישירה, בלי קלישאות ובלי להטיף.')
      : ('You are a gentle journaling-prompt assistant for '+name+'. Your job is to offer one short, warm writing prompt to help them start writing. One or two sentences only, addressed directly to them, no clichés, no lecturing.')
    ) + genderAddressNote();
    var notes = {
      morning: lang==='he' ? ' זה יומן בוקר — הצעה שקשורה לשינה, אנרגיה או כוונה ליום.' : ' This is a morning journal — suggest something about sleep, energy, or intention for the day.',
      evening: lang==='he' ? ' זה סיכום יום — הצעה שמזמינה להביט אחורה על מה שבלט היום.' : ' This is an evening summary — suggest something inviting reflection on what stood out today.',
      gratitude: lang==='he' ? ' זה יומן תודות — הצעה שמזמינה לחשוב על דבר אחד או שניים שיש תודה עליהם.' : ' This is a gratitude journal — suggest something inviting one or two things to be thankful for.',
      chat: lang==='he' ? ' זו כתיבה חופשית — הצעה פתוחה שיכולה להתאים לכל מצב רוח.' : ' This is free writing — offer an open suggestion that could fit any mood.',
      mood: lang==='he' ? ' ' + (state.profile.gender==='m' ? 'המשתמש רושם' : state.profile.gender==='f' ? 'המשתמשת רושמת' : 'המשתמש/ת רושמ/ת') + ' מצב רוח — הצעה שמזמינה לתאר במילים מה עומד מאחורי המצב הזה.' : " The user is logging a mood — suggest something inviting them to put into words what's behind that mood.",
      grounding: lang==='he'
        ? ' זו כתיבה לרגעי מצוקה או חרדה. הצעה עדינה שעוזרת לתאר מה קורה עכשיו, או טכניקת קרקוע פשוטה אחת (נשימה איטית, או תרגיל 5-4-3-2-1 חושי) לתאר תוך כדי תרגול. את/ה לא מטפל/ת מוסמך/ת ואל תתחזה/י לכזה.'
        : " This is writing for moments of distress or anxiety. A gentle suggestion to help describe what's happening right now, or one simple grounding technique (slow breathing, or the 5-4-3-2-1 senses exercise) to describe while practicing it. You are not a licensed therapist and must not claim to be one."
    };
    var backfillNote = '';
    if(backfillDate){
      var bfDateLabel = formatDate(backfillDate);
      backfillNote = lang==='he'
        ? (' זו רשומה רטרואקטיבית על יום מהעבר — '+bfDateLabel+'. ההצעה צריכה להתייחס לאותו יום, לא להיום.')
        : (' This is a retroactive entry about a past day — '+bfDateLabel+'. The suggestion should relate to that day, not today.');
    }
    var memory = recentEntriesDigest();
    var memoryNote = '';
    if(memory){
      memoryNote = lang==='he'
        ? ('\n\nלידיעתך, כמה דברים מיומנו של '+name+' מהתקופה האחרונה (מהחדש לישן). אפשר להתייחס אליהם בעדינות אם רלוונטי, אך אין חובה:\n'+memory)
        : ('\n\nFor your awareness, some recent things from '+name+"'s journal (newest first). You can gently reference these if relevant, but there's no need to:\n"+memory);
    }
    return base + (notes[flow] || '') + backfillNote + memoryNote;
  }

  async function askCompanion(system, messages){
    var res = await window.OfekAI.request({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: system, messages: messages, max_tokens: 300 })
    });
    if(!res.ok) throw new Error('bad status');
    var data = await res.json();
    var text = data && data.content && data.content[0] && data.content[0].text;
    if(!text) throw new Error('empty response');
    return text;
  }

  var dailySummaries = window.OfekDailySummaries.create({
    getState:function(){ return state; },
    saveState:saveState,
    askCompanion:askCompanion,
    moodLabels:MOOD_LABELS,
    flowLabel:function(flow){ return translate(FLOW_KEY[flow] || 'flowChat'); },
    formatDate:formatDate,
    firstPersonNote:genderFirstPersonNote,
    onUpdated:function(){ renderHistory(); }
  });
  window.addEventListener('ofek-ai-settings-change', function(){ dailySummaries.retryFailed(); });

  function genderFirstPersonNote(){
    var lang = state.profile.lang;
    var g = state.profile.gender;
    if(lang === 'he'){
      if(g === 'm') return ' כשאתה כותב בגוף ראשון מטעם המשתמש, השתמש בנטיות פועל בלשון זכר (הלכתי, מרגיש, רוצה וכו׳).';
      if(g === 'f') return ' כשאת כותבת בגוף ראשון מטעם המשתמשת, השתמשי בנטיות פועל בלשון נקבה (הלכתי, מרגישה, רוצה וכו׳).';
      return ' כשכותבים בגוף ראשון מטעם המשתמש/ת, השתמש/י בצורות ניטרליות ככל האפשר — "הרגשתי", "חשבתי", "רציתי" הן ניטרליות. הימנע/י מנטיות מגדריות מובהקות כמו "מרגיש" לעומת "מרגישה".';
    }
    return '';
  }

  function persistEntry(moodVal, note, image){
    var now = new Date();
    var entry = state.entries.find(function(e){ return e.id===activeEntryId; });
    if(!entry){
      entry = { id: activeEntryId, date: backfillDate || todayStr(now), time: timeStr(now), flow: currentFlow, mood: null, createdAt: Date.now() };
      state.entries.push(entry);
    }
    if(typeof moodVal === 'number') entry.mood = moodVal;
    if(note) entry.note = note;
    if(image) entry.image = image;
    saveState();
    updateRibbon();
  }

  function autoGrowTextarea(el){
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }
  document.getElementById('edit-note').addEventListener('input', function(){
    autoGrowTextarea(this);
  });

  function closeFlow(){
    var wasBackfillDate = backfillDate;
    currentFlow = null; activeEntryId = null; backfillDate = null; composerPickedImage = null;
    document.getElementById('composer-host').innerHTML = '';
    if(wasBackfillDate){
      selectedDate = wasBackfillDate;
      switchToPanel('history');
    }
    renderHistory();
    renderInsights();
    if(!wasBackfillDate){
      openFlow('chat');
    }
  }
  /* ============ Composer (freeform entry + optional prompt/mood/summary) ============ */
  function renderComposer(flow){
    var host = document.getElementById('composer-host');
    host.innerHTML = '';
    var lang = state.profile.lang;

    // --- Get a prompt (optional, one-shot AI suggestion - not a conversation) ---
    var promptBtn = document.createElement('button');
    promptBtn.type = 'button'; promptBtn.className = 'prompt-btn';
    promptBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"></path></svg><span>'+translate('getPromptBtn')+'</span>';
    var promptPanel = document.createElement('div');
    promptPanel.className = 'prompt-panel';
    promptPanel.style.display = 'none';
    promptBtn.addEventListener('click', async function(){
      promptBtn.disabled = true;
      promptPanel.style.display = '';
      promptPanel.classList.add('loading');
      promptPanel.textContent = translate('promptLoading');
      try{
        var system = buildPromptSystemMessage(flow);
        var ask = lang==='he' ? 'תן/י לי הצעת כתיבה אחת קצרה.' : 'Give me one short writing prompt.';
        var text = await askCompanion(system, [{role:'user', content: ask}]);
        promptPanel.classList.remove('loading');
        promptPanel.textContent = text;
      }catch(e){
        promptPanel.classList.remove('loading');
        promptPanel.textContent = translate('aiError');
      }
      promptBtn.disabled = false;
    });

    // --- Mood (optional) ---
    var moodToggleBtn = document.createElement('button');
    moodToggleBtn.type = 'button'; moodToggleBtn.className = 'mood-toggle-btn';
    moodToggleBtn.innerHTML = '<span class="mood-dot"></span><span>'+translate('addMoodBtn')+'</span>';
    var moodWrap = document.createElement('div');
    moodWrap.style.display = composerMoodEnabled ? '' : 'none';
    var moodFaceEl = document.createElement('div'); moodFaceEl.className = 'moodface';
    var moodLabelEl = document.createElement('div'); moodLabelEl.className = 'moodlabel';
    var slider = document.createElement('input');
    slider.type = 'range'; slider.min = 0; slider.max = MOOD_STEPS-1; slider.value = 7; slider.className = 'moodslider';
    function updateMoodLabel(){
      var v = Number(slider.value);
      var c = moodColor(v);
      moodFaceEl.innerHTML = moodFaceSVG(v, c, 40);
      moodLabelEl.textContent = MOOD_LABELS[lang][v];
      moodLabelEl.style.color = c;
    }
    slider.addEventListener('input', updateMoodLabel);
    updateMoodLabel();
    moodWrap.appendChild(moodFaceEl); moodWrap.appendChild(moodLabelEl); moodWrap.appendChild(slider);
    moodToggleBtn.addEventListener('click', function(){
      composerMoodEnabled = !composerMoodEnabled;
      moodWrap.style.display = composerMoodEnabled ? '' : 'none';
      moodToggleBtn.classList.toggle('active', composerMoodEnabled);
    });

    // --- Freeform textarea ---
    var textarea = document.createElement('textarea');
    textarea.className = 'entry-textarea'; textarea.rows = 6;
    textarea.placeholder = translate('composerPh');

    // --- Image attachment ---
    var pickedImage = null;
    var imageRow = document.createElement('div'); imageRow.className = 'moodimage-row';
    var imgBtn = document.createElement('button');
    imgBtn.type = 'button';
    imgBtn.className = 'moodimage-btn';
    imgBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="12" cy="12" r="3.5"></circle><path d="M7 5l1.5-2h7L17 5"></path></svg>'+
                        '<span>'+(lang==='he' ? 'הוסף תמונה' : 'Add photo')+'</span>';
    var fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.style.display = 'none';
    var previewWrap = document.createElement('div'); previewWrap.className = 'moodimage-preview'; previewWrap.style.display = 'none';
    var previewImg = document.createElement('img');
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-btn';
    removeBtn.setAttribute('aria-label', lang==='he' ? 'הסר תמונה' : 'Remove photo');
    removeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    previewWrap.appendChild(previewImg);
    previewWrap.appendChild(removeBtn);
    imageRow.appendChild(imgBtn);
    imageRow.appendChild(previewWrap);
    imageRow.appendChild(fileInput);

    var errorEl = document.createElement('div'); errorEl.className = 'moodimage-error'; errorEl.style.display = 'none';

    function setPickedImage(dataUrl){
      pickedImage = dataUrl;
      composerPickedImage = dataUrl;
      if(dataUrl){
        previewImg.src = dataUrl;
        previewWrap.style.display = '';
        imgBtn.classList.add('has-image');
      } else {
        previewImg.src = '';
        previewWrap.style.display = 'none';
        imgBtn.classList.remove('has-image');
      }
    }

    imgBtn.addEventListener('click', function(){ fileInput.click(); });
    fileInput.addEventListener('change', function(){
      errorEl.style.display = 'none';
      errorEl.textContent = '';
      var file = fileInput.files && fileInput.files[0];
      if(!file) return;
      window.OfekImages.readAndCompress(file).then(function(dataUrl){
        setPickedImage(dataUrl);
        fileInput.value = '';
      }).catch(function(){
        errorEl.textContent = lang==='he' ? 'לא הצלחתי לטעון את התמונה. ' + genderVariant('נסה','נסי','נסה/י') + ' שוב.' : "Couldn't load that image. Try another one.";
        errorEl.style.display = '';
        fileInput.value = '';
      });
    });
    removeBtn.addEventListener('click', function(){
      setPickedImage(null);
    });

    // --- Validation note (shown if trying to save with no text) ---
    var validationEl = document.createElement('div'); validationEl.className = 'moodimage-error'; validationEl.style.display = 'none';

    // --- Save (the History renderer refreshes the whole-day AI summary) ---
    var saveBtn = document.createElement('button');
    saveBtn.type = 'button'; saveBtn.className = 'btn-primary'; saveBtn.textContent = translate('endFlow'); saveBtn.disabled = true;
    function updateSaveAvailability(){
      saveBtn.disabled = !textarea.value.trim();
    }
    textarea.addEventListener('input', updateSaveAvailability);
    textarea.addEventListener('keydown', function(event){
      if((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !saveBtn.disabled){
        event.preventDefault();
        saveBtn.click();
      }
    });
    saveBtn.addEventListener('click', function(){
      var text = textarea.value.trim();
      if(!text){
        validationEl.textContent = translate('composerNeedText');
        validationEl.style.display = '';
        textarea.focus();
        return;
      }
      validationEl.style.display = 'none';
      saveBtn.disabled = true;
      saveBtn.textContent = translate('saving');
      var moodVal = composerMoodEnabled ? Number(slider.value) : null;
      persistEntry(moodVal, text, pickedImage);
      closeFlow();
      showEntrySavedToast(true);
    });
    var actionsRow = document.createElement('div'); actionsRow.className = 'composer-actions';
    actionsRow.appendChild(saveBtn);

    var toolbar = document.createElement('div'); toolbar.className = 'composer-toolbar';
    toolbar.appendChild(promptBtn);
    if(flow !== 'mood'){
      toolbar.appendChild(moodToggleBtn);
    }

    host.appendChild(toolbar);
    host.appendChild(promptPanel);
    host.appendChild(moodWrap);
    host.appendChild(textarea);
    host.appendChild(imageRow);
    host.appendChild(errorEl);
    host.appendChild(validationEl);
    host.appendChild(actionsRow);
  }

  /* ============ Grounding chat (real-time, distinct from the freeform composer) ============ */
  // The crisis-support flow stays a genuine back-and-forth conversation, since
  // following someone's pace in the moment matters more here than anywhere
  // else in the app - unlike every other flow, this one isn't a fit for
  // "write freely, optionally get one suggestion."
  var groundingMessages = []; // {role:'user'|'assistant', content}

  function buildGroundingChatSystemMessage(){
    var lang = state.profile.lang;
    var name = state.profile.name;
    return (lang==='he'
      ? ('את/ה אופק, נוכחות רגועה ותומכת עבור '+name+' ברגע של מצוקה או חרדה. דבר/י בקצרה ובחום - משפט או שניים בכל פעם - ושאל/י שאלה אחת או הצע/י דבר אחד בכל תגובה, לא יותר. אפשר להציע טכניקות קרקוע פשוטות (נשימה איטית, תרגיל חושי של 5-4-3-2-1) אבל רק כשזה מתאים, בלי לכפות. עקוב/י אחרי הקצב של '+name+'. את/ה לא מטפל/ת מוסמך/ת ולא מספק/ת אבחון או טיפול - אם נשמע שהמצב חמור, אפשר להזכיר בעדינות שער"ן זמינים בחינם ב-1201.')
      : ("You are Ofek, a calm, supportive presence for "+name+" during a moment of distress or anxiety. Speak briefly and warmly - one or two sentences at a time - and ask one question or offer one suggestion per reply, no more. You can suggest simple grounding techniques (slow breathing, the 5-4-3-2-1 senses exercise) but only when it fits, never forced. Follow "+name+"'s pace. You are not a licensed therapist and don't diagnose or treat - if things sound serious, you can gently mention that ER'N is free to call at 1201.")
    ) + genderAddressNote();
  }

  function addGroundingBubble(role, text){
    var thread = document.getElementById('grounding-thread');
    if(!thread) return null;
    var b = document.createElement('div');
    b.className = 'g-bubble ' + role;
    b.textContent = text;
    thread.appendChild(b);
    b.scrollIntoView({behavior:'smooth', block:'end'});
    return b;
  }

  function setGroundingSending(loading){
    var sendBtn = document.getElementById('grounding-send-btn');
    if(sendBtn) sendBtn.disabled = loading;
    var thread = document.getElementById('grounding-thread');
    var typing = document.getElementById('grounding-typing');
    if(loading && !typing && thread){
      typing = document.createElement('div');
      typing.id = 'grounding-typing';
      typing.className = 'g-bubble assistant g-typing';
      typing.textContent = '…';
      thread.appendChild(typing);
      typing.scrollIntoView({behavior:'smooth', block:'end'});
    } else if(!loading && typing){
      typing.remove();
    }
  }

  async function sendGroundingMessage(){
    var input = document.getElementById('grounding-input');
    var text = input.value.trim();
    if(!text) return;
    addGroundingBubble('user', text);
    groundingMessages.push({role:'user', content:text});
    input.value = '';
    autoGrowTextarea(input);
    setGroundingSending(true);
    try{
      var reply = await askCompanion(buildGroundingChatSystemMessage(), groundingMessages);
      setGroundingSending(false);
      addGroundingBubble('assistant', reply);
      groundingMessages.push({role:'assistant', content:reply});
    }catch(e){
      setGroundingSending(false);
      addGroundingBubble('assistant', translate('aiError'));
    }
  }

  async function finishGroundingChat(){
    if(groundingMessages.length){
      var lang = state.profile.lang;
      var transcript = groundingMessages.map(function(m){
        var who = m.role === 'user' ? (state.profile.name || (lang==='he' ? 'אני' : 'Me')) : 'Ofek';
        return who + ': ' + m.content;
      }).join('\n');
      persistEntry(null, transcript, null);
      closeFlow();
      showEntrySavedToast(true);
    } else {
      closeFlow();
    }
  }

  function renderGroundingChat(){
    var host = document.getElementById('composer-host');
    host.innerHTML = '';
    groundingMessages = [];

    var thread = document.createElement('div');
    thread.className = 'grounding-thread';
    thread.id = 'grounding-thread';

    var inputRow = document.createElement('div');
    inputRow.className = 'grounding-input-row';
    var input = document.createElement('textarea');
    input.id = 'grounding-input';
    input.className = 'grounding-input';
    input.rows = 1;
    input.placeholder = translate('composerPh');
    var sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.id = 'grounding-send-btn';
    sendBtn.className = 'grounding-send-btn';
    sendBtn.setAttribute('aria-label', state.profile.lang==='he' ? 'שליחה' : 'Send');
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>';
    input.addEventListener('input', function(){ autoGrowTextarea(input); });
    input.addEventListener('keydown', function(e){
      if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendGroundingMessage(); }
    });
    sendBtn.addEventListener('click', sendGroundingMessage);
    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);

    var finishRow = document.createElement('div');
    finishRow.className = 'composer-actions grounding-finish-row';
    var finishBtn = document.createElement('button');
    finishBtn.type = 'button';
    finishBtn.className = 'grounding-finish-btn';
    finishBtn.textContent = translate('endFlow');
    finishBtn.addEventListener('click', finishGroundingChat);
    finishRow.appendChild(finishBtn);

    host.appendChild(thread);
    host.appendChild(inputRow);
    host.appendChild(finishRow);

    // AI opens the conversation gently, rather than waiting on the person
    // to find the first words during a hard moment.
    setGroundingSending(true);
    var lang = state.profile.lang;
    var kickoffAsk = lang==='he' ? 'פתח/י את השיחה בעדינות.' : 'Open the conversation gently.';
    askCompanion(buildGroundingChatSystemMessage(), [{role:'user', content: kickoffAsk}]).then(function(reply){
      setGroundingSending(false);
      addGroundingBubble('assistant', reply);
      groundingMessages.push({role:'assistant', content:reply});
    }).catch(function(){
      setGroundingSending(false);
      addGroundingBubble('assistant', translate('aiError'));
    });
  }



  /* ============ Nav (bottom bar + sidebar) ============ */
  function switchToPanel(targetPanel){
    document.querySelectorAll('.nav-btn').forEach(function(b){
      b.classList.toggle('active', b.dataset.panel === targetPanel);
    });
    document.querySelectorAll('.panel').forEach(function(p){ p.classList.remove('active'); });
    document.getElementById('panel-'+targetPanel).classList.add('active');
    var main = document.querySelector('main');
    if(main) main.scrollTop = 0;
    if(targetPanel==='history') renderHistory();
    if(targetPanel==='insights') renderInsights();
    if(targetPanel==='habits') renderHabits();
  }
  document.querySelectorAll('.nav-btn').forEach(function(btn){
    btn.addEventListener('click', function(){ switchToPanel(btn.dataset.panel); });
  });

  /* ============ Calendar ============ */
  var calendarMonth = new Date(); calendarMonth.setDate(1); calendarMonth.setHours(0,0,0,0);
  var calendarExpanded = false;
  var selectedDate = null; // currently filtered day in History, format 'YYYY-MM-DD'
  var historyRangeFilter = null; // {start, end, label}; set by actionable Insights links
  var WD_SHORT = { he:['א','ב','ג','ד','ה','ו','ש'], en:['Su','Mo','Tu','We','Th','Fr','Sa'] };

  function idealTextOn(rgbStr){
    var nums = rgbStr.match(/\d+/g).map(Number);
    var lum = 0.299*nums[0] + 0.587*nums[1] + 0.114*nums[2];
    return lum > 150 ? '#2B2E33' : '#FAF8F4';
  }

  function jumpToDay(dateKey){
    // toggle off if clicking the same day
    if(selectedDate === dateKey){
      selectedDate = null;
    } else {
      selectedDate = dateKey;
    }
    historyRangeFilter = null;
    calendarExpanded = false;
    renderHistory();
  }
  function clearSelectedDate(){
    selectedDate = null;
    renderHistory();
  }

  function openHistoryRange(range, label){
    selectedDate = null;
    calendarExpanded = false;
    calendarMonth = new Date(range.start);
    calendarMonth.setDate(1);
    historyRangeFilter = {
      start:todayStr(range.start),
      end:todayStr(range.end),
      label:label
    };
    switchToPanel('history');
  }

  function clearHistoryRange(){
    historyRangeFilter = null;
    renderHistory();
  }

  function renderCalendar(){
    var host = document.getElementById('calendar-host');
    if(!host) return;
    host.innerHTML = '';
    host.classList.toggle('is-expanded', calendarExpanded);
    var lang = state.profile.lang;
    var year = calendarMonth.getFullYear(), month = calendarMonth.getMonth();

    var header = document.createElement('div'); header.className = 'cal-header';
    var title = document.createElement('button'); title.type = 'button'; title.className = 'cal-title';
    title.setAttribute('aria-expanded', String(calendarExpanded));
    title.setAttribute('aria-controls', 'calendar-grid');
    var monthLabel = document.createElement('span'); monthLabel.textContent = MONTHS[lang][month] + ' ' + year;
    var toggleLabel = document.createElement('span'); toggleLabel.className = 'cal-toggle-label';
    toggleLabel.textContent = translate(calendarExpanded ? 'hideCalendar' : 'showCalendar');
    title.appendChild(monthLabel); title.appendChild(toggleLabel);
    title.addEventListener('click', function(){ calendarExpanded = !calendarExpanded; renderCalendar(); });

    var navWrap = document.createElement('div'); navWrap.className = 'cal-nav'; navWrap.hidden = !calendarExpanded;
    var now = new Date();
    if(year !== now.getFullYear() || month !== now.getMonth()){
      var todayBtn = document.createElement('button'); todayBtn.className = 'cal-today-btn';
      todayBtn.textContent = translate('calToday');
      todayBtn.addEventListener('click', function(){
        calendarMonth = new Date(); calendarMonth.setDate(1); calendarMonth.setHours(0,0,0,0);
        renderCalendar();
      });
      navWrap.appendChild(todayBtn);
    }

    var prevBtn = document.createElement('button'); prevBtn.className = 'icon-btn cal-nav-btn';
    prevBtn.innerHTML = SVG_CHEVRON_LEFT;
    prevBtn.setAttribute('aria-label', translate('previousMonth'));
    prevBtn.addEventListener('click', function(){ calendarMonth.setMonth(calendarMonth.getMonth()-1); renderCalendar(); });

    var nextBtn = document.createElement('button'); nextBtn.className = 'icon-btn cal-nav-btn';
    nextBtn.innerHTML = SVG_CHEVRON_RIGHT;
    nextBtn.setAttribute('aria-label', translate('nextMonth'));
    nextBtn.addEventListener('click', function(){ calendarMonth.setMonth(calendarMonth.getMonth()+1); renderCalendar(); });

    navWrap.appendChild(prevBtn); navWrap.appendChild(nextBtn);
    header.appendChild(title); header.appendChild(navWrap);
    host.appendChild(header);

    var grid = document.createElement('div'); grid.className = 'cal-grid'; grid.id = 'calendar-grid'; grid.hidden = !calendarExpanded;
    WD_SHORT[lang].forEach(function(w){
      var el = document.createElement('div'); el.className = 'cal-wd'; el.textContent = w;
      grid.appendChild(el);
    });

    var firstDow = new Date(year, month, 1).getDay();
    for(var i=0;i<firstDow;i++){
      var padCell = document.createElement('div'); padCell.className = 'cal-cell empty-slot';
      grid.appendChild(padCell);
    }

    var daysInMonth = new Date(year, month+1, 0).getDate();
    var todayKey = todayStr();
    for(var d=1; d<=daysInMonth; d++){
      var dateKey = year+'-'+pad(month+1)+'-'+pad(d);
      var dayEntries = state.entries.filter(function(e){ return e.date===dateKey; });
      var cell = document.createElement('button'); cell.type = 'button'; cell.className = 'cal-cell';
      cell.textContent = d;
      cell.dataset.date = dateKey;
      if(dateKey===todayKey) cell.classList.add('is-today');
      if(dateKey > todayKey) cell.classList.add('is-future');
      if(dateKey === selectedDate) cell.classList.add('is-selected');
      cell.setAttribute('aria-pressed', dateKey === selectedDate ? 'true' : 'false');
      cell.setAttribute('aria-label', formatDate(dateKey));

      if(dayEntries.length){
        var moods = dayEntries.filter(function(e){ return typeof e.mood==='number'; }).map(function(e){ return e.mood; });
        var lineColor;
        if(moods.length){
          var avg = moods.reduce(function(a,b){ return a+b; },0)/moods.length;
          lineColor = moodColor(avg);
        } else {
          lineColor = 'var(--accent)';
        }
        cell.classList.add('has-entry');
        cell.style.setProperty('--mood-line-color', lineColor);
      }
      // Only allow selection of today and past days.
      if(dateKey <= todayKey){
        cell.addEventListener('click', (function(key){ return function(){ jumpToDay(key); }; })(dateKey));
      } else {
        cell.disabled = true;
      }
      grid.appendChild(cell);
    }
    host.appendChild(grid);
  }

  /* ============ History ============ */
  function buildAddEntryButton(dateKey){
    var lang = state.profile.lang;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'add-entry-btn';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>'+
                     '<span>'+(lang==='he' ? 'הוספת רשומה' : 'Add entry')+'</span>';
    btn.addEventListener('click', function(){ openAddEntry(dateKey); });
    return btn;
  }

  function renderHistory(){
    renderCalendar();
    var list = document.getElementById('history-list');
    list.innerHTML = '';
    if(historyRangeFilter){
      var rangeEntries = state.entries.filter(function(entry){
        return entry.date >= historyRangeFilter.start && entry.date <= historyRangeFilter.end;
      });
      var rangeBar = document.createElement('div');
      rangeBar.className = 'cal-filter-bar';
      var rangeCopy = document.createElement('div');
      var rangeLabel = document.createElement('div'); rangeLabel.className = 'cal-filter-label';
      rangeLabel.textContent = historyRangeFilter.label;
      var rangeSub = document.createElement('div'); rangeSub.className = 'cal-filter-sub';
      rangeSub.textContent = state.profile.lang === 'he'
        ? rangeEntries.length + ' רשומות בתקופה הזו'
        : rangeEntries.length + (rangeEntries.length === 1 ? ' entry in this period' : ' entries in this period');
      rangeCopy.appendChild(rangeLabel); rangeCopy.appendChild(rangeSub);
      var rangeClear = document.createElement('button'); rangeClear.type = 'button'; rangeClear.className = 'cal-filter-clear';
      rangeClear.textContent = state.profile.lang === 'he' ? 'הצגת הכול' : 'Show all';
      rangeClear.addEventListener('click', clearHistoryRange);
      rangeBar.appendChild(rangeCopy); rangeBar.appendChild(rangeClear);
      list.appendChild(rangeBar);
      if(!rangeEntries.length){
        var rangeEmpty = document.createElement('div'); rangeEmpty.className = 'empty-state';
        rangeEmpty.textContent = translate('historyEmpty'); list.appendChild(rangeEmpty); return;
      }
      var rangeDates = Array.from(new Set(rangeEntries.map(function(entry){ return entry.date; }))).sort().reverse();
      renderDayCards(list, rangeDates, rangeEntries);
      return;
    }
    // If a specific day is selected, show a filter bar and entries for that day only.
    if(selectedDate){
      var filterBar = document.createElement('div');
      filterBar.className = 'cal-filter-bar';
      var labelWrap = document.createElement('div');
      var labelEl = document.createElement('div'); labelEl.className = 'cal-filter-label';
      labelEl.textContent = formatDate(selectedDate);
      var subEl = document.createElement('div'); subEl.className = 'cal-filter-sub';
      var dayEnts = state.entries.filter(function(e){ return e.date === selectedDate; });
      var lang = state.profile.lang;
      if(dayEnts.length){
        subEl.textContent = lang === 'he'
          ? (dayEnts.length + ' רשומות ביום הזה')
          : (dayEnts.length + (dayEnts.length === 1 ? ' entry on this day' : ' entries on this day'));
      } else {
        subEl.textContent = lang === 'he' ? 'אין רשומות ביום הזה' : 'No entries on this day';
      }
      labelWrap.appendChild(labelEl); labelWrap.appendChild(subEl);
      var clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'cal-filter-clear';
      clearBtn.textContent = lang === 'he' ? 'הצג הכל' : 'Show all';
      clearBtn.addEventListener('click', clearSelectedDate);
      filterBar.appendChild(labelWrap); filterBar.appendChild(clearBtn);
      list.appendChild(filterBar);

      if(!dayEnts.length){
        var empty = document.createElement('div');
        empty.className = 'empty-state';
        var emptyMsg = document.createElement('div');
        emptyMsg.textContent = lang === 'he' ? 'לא רשומים דברים מהיום הזה.' : 'Nothing logged for this day yet.';
        empty.appendChild(emptyMsg);
        empty.appendChild(buildAddEntryButton(selectedDate));
        list.appendChild(empty);
        return;
      }
      // Render only the selected day
      renderDayCards(list, [selectedDate], dayEnts);
      var addRow = document.createElement('div');
      addRow.className = 'day-add-row';
      addRow.appendChild(buildAddEntryButton(selectedDate));
      list.appendChild(addRow);
      return;
    }
    if(!state.entries.length){
      list.innerHTML = '<div class="empty-state"></div>';
      list.querySelector('.empty-state').textContent = translate('historyEmpty');
      return;
    }
    var byDate = {};
    state.entries.forEach(function(e){ (byDate[e.date] = byDate[e.date] || []).push(e); });
    var dates = Object.keys(byDate).sort().reverse();
    dates.forEach(function(date){
      var dayEntries = byDate[date].slice().sort(function(a,b){ return a.time.localeCompare(b.time); });
      var card = buildDayCard(date, dayEntries);
      list.appendChild(card);
    });
  }

  function buildDayCard(date, dayEntries){
    var moods = dayEntries.filter(function(e){ return typeof e.mood==='number'; }).map(function(e){ return e.mood; });
    var avgMood = moods.length ? moods.reduce(function(a,b){ return a+b; },0)/moods.length : null;

    var card = document.createElement('div'); card.className = 'day-card'; card.dataset.date = date;
    var bodyId = 'day-body-' + date;
    var head = document.createElement('button'); head.type = 'button'; head.className = 'day-head';
    head.setAttribute('aria-expanded', 'false');
    head.setAttribute('aria-controls', bodyId);
    var swatch = document.createElement('div'); swatch.className = 'day-swatch';
    swatch.style.background = avgMood!==null ? moodColor(avgMood) : 'var(--line)';
    var meta = document.createElement('div'); meta.className = 'day-meta';
    var dateEl = document.createElement('div'); dateEl.className = 'day-date'; dateEl.textContent = formatDate(date);
    var dailySummary = dailySummaries.get(date, dayEntries);
    var summaryEl = document.createElement('div'); summaryEl.className = 'day-summary';
    summaryEl.textContent = dailySummary.text;
    if(dailySummary.status === 'loading'){
      summaryEl.classList.add('is-loading');
      summaryEl.setAttribute('aria-live', 'polite');
    }
    meta.appendChild(dateEl); meta.appendChild(summaryEl);
    var details = document.createElement('div'); details.className = 'day-details';
    var count = document.createElement('span'); count.className = 'day-count';
    count.textContent = state.profile.lang === 'he'
      ? dayEntries.length + ' רשומות'
      : dayEntries.length + (dayEntries.length === 1 ? ' entry' : ' entries');
    var chevron = document.createElement('span'); chevron.className = 'day-chevron';
    chevron.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    details.appendChild(count); details.appendChild(chevron);
    head.appendChild(swatch); head.appendChild(meta); head.appendChild(details);

    var body = document.createElement('div'); body.className = 'day-body'; body.id = bodyId; body.hidden = true;
    dayEntries.forEach(function(e){
      var row = document.createElement('div'); row.className = 'entry-row';
      var top = document.createElement('div'); top.className = 'entry-top';
      var timeSpan = document.createElement('span'); timeSpan.className = 'entry-time'; timeSpan.textContent = e.time;
      var flowSpan = document.createElement('span'); flowSpan.className = 'entry-flow'; flowSpan.textContent = translate(FLOW_KEY[e.flow] || 'flowChat');
      top.appendChild(timeSpan); top.appendChild(flowSpan);
      // Edit + delete buttons
      var actions = document.createElement('div'); actions.className = 'entry-actions';
      var editBtn = document.createElement('button');
      editBtn.type = 'button'; editBtn.className = 'entry-action-btn edit';
      editBtn.setAttribute('aria-label', state.profile.lang === 'he' ? 'עריכה' : 'Edit');
      editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>';
      editBtn.addEventListener('click', function(ev){ ev.stopPropagation(); openEditEntry(e.id); });
      var delBtn = document.createElement('button');
      delBtn.type = 'button'; delBtn.className = 'entry-action-btn delete';
      delBtn.setAttribute('aria-label', state.profile.lang === 'he' ? 'מחיקה' : 'Delete');
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>';
      delBtn.addEventListener('click', function(ev){ ev.stopPropagation(); deleteEntry(e.id); });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      top.appendChild(actions);
      if(e.image){
        var imgWrap = document.createElement('div');
        imgWrap.className = 'entry-image';
        var img = document.createElement('img');
        img.src = e.image; img.alt = '';
        imgWrap.appendChild(img);
        row.appendChild(imgWrap);
      }
      var textEl = document.createElement('div'); textEl.className = 'entry-text';
      var lines = [];
      if(typeof e.mood==='number') lines.push(MOOD_LABELS[state.profile.lang][e.mood]);
      if(e.note) lines.push(e.note);
      (e.messages || []).forEach(function(message){
        var messageText = message.text || message.content;
        if(messageText) lines.push((message.role === 'ai' || message.role === 'assistant' ? '— ' : '') + messageText);
      });
      if(!lines.length && e.summary) lines.push(e.summary);
      textEl.textContent = lines.join(' · ');
      row.appendChild(top); row.appendChild(textEl);
      body.appendChild(row);
    });

    function updateDayLabel(isOpen){
      head.setAttribute('aria-label', formatDate(date) + '. ' + dailySummary.text + '. ' + count.textContent + '. ' + translate(isOpen ? 'collapseDay' : 'expandDay'));
    }
    updateDayLabel(false);
    head.addEventListener('click', function(){
      var isOpen = card.classList.toggle('open');
      head.setAttribute('aria-expanded', String(isOpen));
      body.hidden = !isOpen;
      updateDayLabel(isOpen);
    });

    card.appendChild(head); card.appendChild(body);
    return card;
  }

  function renderDayCards(container, dates, dayEnts){
    // dates is a list of YYYY-MM-DD strings; dayEnts is the matching entries (optional)
    var grouped = {};
    (dayEnts || state.entries).forEach(function(e){
      (grouped[e.date] = grouped[e.date] || []).push(e);
    });
    dates.forEach(function(date){
      var entries = (grouped[date] || []).slice().sort(function(a,b){ return a.time.localeCompare(b.time); });
      var card = buildDayCard(date, entries);
      container.appendChild(card);
    });
  }

  /* ============ Insights ============ */
  function statCard(num, lbl, detail, action){
    var d = document.createElement(action ? 'button' : 'div');
    d.className = 'stat-card' + (action ? ' actionable' : '');
    if(action){ d.type = 'button'; d.addEventListener('click', action); }
    var numEl = document.createElement('div'); numEl.className = 'num'; numEl.textContent = num;
    var lblEl = document.createElement('div'); lblEl.className = 'lbl'; lblEl.textContent = lbl;
    d.appendChild(numEl); d.appendChild(lblEl);
    if(detail){
      var detailEl = document.createElement('div'); detailEl.className = 'detail'; detailEl.textContent = detail;
      d.appendChild(detailEl);
    }
    return d;
  }

  function startOfWeek(d){
    var x = new Date(d); x.setHours(0,0,0,0);
    x.setDate(x.getDate() - x.getDay());
    return x;
  }
  function addDays(d, n){ var x = new Date(d); x.setDate(x.getDate()+n); return x; }

  function periodRange(period, anchor){
    if(period === 'week'){
      var start = startOfWeek(anchor);
      return { start: start, end: addDays(start, 6) };
    }
    if(period === 'year'){
      return { start: new Date(anchor.getFullYear(), 0, 1), end: new Date(anchor.getFullYear(), 11, 31) };
    }
    return { start: new Date(anchor.getFullYear(), anchor.getMonth(), 1), end: new Date(anchor.getFullYear(), anchor.getMonth()+1, 0) };
  }

  function shiftAnchor(period, dir){
    var a = new Date(insightsAnchor);
    if(period==='week') a.setDate(a.getDate() + 7*dir);
    else if(period==='year') a.setFullYear(a.getFullYear() + dir);
    else a.setMonth(a.getMonth() + dir);
    insightsAnchor = a;
  }

  function previousPeriodRange(period, range){
    if(period === 'week') return {start:addDays(range.start, -7), end:addDays(range.end, -7)};
    if(period === 'year') return {start:new Date(range.start.getFullYear()-1, 0, 1), end:new Date(range.start.getFullYear()-1, 11, 31)};
    return {start:new Date(range.start.getFullYear(), range.start.getMonth()-1, 1), end:new Date(range.start.getFullYear(), range.start.getMonth(), 0)};
  }

  function entriesInRange(range){
    var start = todayStr(range.start), end = todayStr(range.end);
    return state.entries.filter(function(entry){ return entry.date >= start && entry.date <= end; });
  }

  function summarizeEntries(entries){
    var moods = entries.filter(function(entry){ return typeof entry.mood === 'number'; }).map(function(entry){ return entry.mood; });
    var days = Array.from(new Set(entries.map(function(entry){ return entry.date; })));
    return {
      entries:entries,
      entryCount:entries.length,
      activeDays:days.length,
      moodCount:moods.length,
      avgMood:moods.length ? moods.reduce(function(total, mood){ return total + mood; }, 0) / moods.length : null
    };
  }

  function signedComparison(current, previous){
    var diff = current - previous;
    if(diff === 0) return state.profile.lang === 'he' ? 'ללא שינוי' : 'No change';
    return (diff > 0 ? '+' : '') + diff + (state.profile.lang === 'he' ? ' מהתקופה הקודמת' : ' vs previous');
  }

  function openWritingFromInsight(withMood){
    switchToPanel('chat');
    openFlow(withMood ? 'mood' : 'chat');
    setTimeout(function(){
      var input = document.querySelector('#composer-host .entry-textarea');
      if(input) input.focus();
    }, 0);
  }

  function isCurrentPeriod(period, anchor){
    var now = new Date();
    if(period==='week') return todayStr(startOfWeek(now)) === todayStr(startOfWeek(anchor));
    if(period==='year') return now.getFullYear() === anchor.getFullYear();
    return now.getFullYear()===anchor.getFullYear() && now.getMonth()===anchor.getMonth();
  }

  function formatPeriodLabel(period, range){
    var lang = state.profile.lang;
    var LRI = '\u2066', PDI = '\u2069'; // isolate marks: keep "14–20" from visually reordering inside RTL text
    if(period === 'year') return String(range.start.getFullYear());
    if(period === 'month') return MONTHS[lang][range.start.getMonth()] + ' ' + range.start.getFullYear();
    var s = range.start, e = range.end;
    var sMonth = MONTHS[lang][s.getMonth()], eMonth = MONTHS[lang][e.getMonth()];
    var sameMonth = s.getMonth()===e.getMonth();
    if(sameMonth){
      var rangeStr = LRI + s.getDate()+'–'+e.getDate() + PDI;
      return lang==='he' ? (rangeStr+' ב'+sMonth) : (sMonth+' '+rangeStr);
    }
    if(lang==='he'){
      return s.getDate()+' ב'+sMonth+' – '+e.getDate()+' ב'+eMonth;
    }
    return sMonth+' '+s.getDate()+' – '+eMonth+' '+e.getDate();
  }

  function renderHorizonChart(period, range){
    var section = document.createElement('section'); section.className = 'mood-timeline';
    var heading = document.createElement('div'); heading.className = 'insight-section-heading';
    var title = document.createElement('h2'); title.textContent = translate('moodTimelineTitle');
    var help = document.createElement('span'); help.textContent = translate('moodScaleHelp');
    heading.appendChild(title); heading.appendChild(help); section.appendChild(heading);

    var points = [];
    if(period === 'year'){
      for(var month = 0; month < 12; month++){
        var monthKey = range.start.getFullYear() + '-' + pad(month + 1);
        points.push({
          label:MONTHS[state.profile.lang][month].slice(0, 3),
          moods:state.entries.filter(function(entry){ return typeof entry.mood === 'number' && entry.date.slice(0, 7) === monthKey; }).map(function(entry){ return entry.mood; })
        });
      }
    } else {
      var cursor = new Date(range.start);
      while(cursor <= range.end){
        var key = todayStr(cursor);
        points.push({
          label:period === 'week' ? WD_SHORT[state.profile.lang][cursor.getDay()] : String(cursor.getDate()),
          moods:state.entries.filter(function(entry){ return entry.date === key && typeof entry.mood === 'number'; }).map(function(entry){ return entry.mood; })
        });
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    var moodCount = points.reduce(function(total, point){ return total + point.moods.length; }, 0);
    if(!moodCount){
      var empty = document.createElement('div'); empty.className = 'insight-empty-action';
      var progress = document.createElement('div'); progress.className = 'insight-empty-copy';
      progress.textContent = translate('moodProgressEmpty');
      var addMood = document.createElement('button'); addMood.type = 'button'; addMood.className = 'secondary-action';
      addMood.textContent = translate('addMoodAction'); addMood.addEventListener('click', function(){ openWritingFromInsight(true); });
      empty.appendChild(progress); empty.appendChild(addMood); section.appendChild(empty);
      return section;
    }

    var chart = document.createElement('div'); chart.className = 'horizon-chart period-' + period;
    chart.setAttribute('role', 'img');
    var textSummary = [];
    points.forEach(function(point){
      var pointEl = document.createElement('div'); pointEl.className = 'horizon-point';
      var value = document.createElement('div'); value.className = 'horizon-value';
      if(point.moods.length){
        var avg = point.moods.reduce(function(a,b){ return a+b; },0) / point.moods.length;
        value.textContent = avg.toFixed(1);
        value.style.setProperty('--mood-color', moodColor(avg));
        value.classList.add('has-mood');
        textSummary.push(point.label + ' ' + avg.toFixed(1));
      } else {
        value.textContent = '—';
      }
      var label = document.createElement('span'); label.textContent = point.label;
      pointEl.appendChild(value); pointEl.appendChild(label); chart.appendChild(pointEl);
    });
    chart.setAttribute('aria-label', translate('moodTimelineTitle') + ': ' + textSummary.join(', '));
    section.appendChild(chart);
    var legend = document.createElement('p'); legend.className = 'chart-text-summary';
    legend.textContent = translate('moodTextSummary') + ' ' + textSummary.join(' · ');
    section.appendChild(legend);
    return section;
  }

  function reflectionCacheKey(range){
    return 'period-' + todayStr(range.start) + '-' + todayStr(range.end);
  }

  async function generatePeriodReflection(range){
    var lang = state.profile.lang;
    var entries = entriesInRange(range);
    var summary = entries.map(function(e){
      var moodPart = typeof e.mood==='number' ? MOOD_LABELS[lang][e.mood]+': ' : '';
      var textPart = (e.messages||[]).filter(function(m){ return m.role==='user'; }).map(function(m){ return m.text; }).join(' ') || e.note || '';
      return moodPart+textPart;
    }).filter(Boolean).join('\n');

    var system = (lang==='he'
      ? ('את/ה אופק. הנה רשומות של '+state.profile.name+' מהתקופה שנבחרה. כתוב/כתבי פסקה קצרה (2–4 משפטים), חמה ולא שיפוטית, שמשקפת דפוס או תובנה אחת. ציין/י בעדינות על אילו ימים או רשומות התובנה נשענת. לא רשימה ולא סיכום מכני.')
      : ("You are Ofek. Here are "+state.profile.name+"'s entries from the selected period. Write one short, warm, non-judgmental paragraph (2-4 sentences) reflecting a single pattern or insight. Gently name which days or entries support it. Do not use a list or mechanical summary."))
      + genderAddressNote();

    var userMsg = summary || (lang==='he' ? 'אין הרבה לעבוד איתו השבוע.' : 'Not much to go on this week.');
    return await askCompanion(system, [{role:'user', content: userMsg}]);
  }

  function renderReflectCard(range, summary){
    var card = document.createElement('div'); card.className = 'reflect-card';
    var cacheKey = reflectionCacheKey(range);
    var cached = state.weeklyCache[cacheKey];
    var btn = document.createElement('button'); btn.className = 'reflect-btn'; btn.textContent = translate('reflectBtn');
    var p = document.createElement('p');
    var requirement = document.createElement('div'); requirement.className = 'insight-requirement';
    var requirementCopy = document.createElement('span');
    requirementCopy.textContent = '\u2066' + summary.activeDays + ' / 2\u2069 ' + translate('activeWritingDays');
    var requirementTrack = document.createElement('span'); requirementTrack.className = 'requirement-track';
    var requirementFill = document.createElement('span'); requirementFill.style.width = Math.min(100, summary.activeDays / 2 * 100) + '%';
    requirementTrack.appendChild(requirementFill); requirement.appendChild(requirementCopy); requirement.appendChild(requirementTrack);
    if(cached){
      p.textContent = cached;
    } else if(summary.activeDays < 2){
      p.textContent = translate('reflectExactRequirement');
      btn.disabled = true;
    } else {
      p.textContent = translate('reflectReady');
    }

    btn.addEventListener('click', async function(){
      btn.disabled = true; p.style.opacity = '1'; p.textContent = translate('reflectLoading');
      try{
        var text = await generatePeriodReflection(range);
        state.weeklyCache[cacheKey] = text;
        saveState();
        p.style.opacity = '0';
        setTimeout(function(){ p.textContent = text; p.style.opacity = '1'; }, 180);
      }catch(e){
        p.style.opacity = '0';
        setTimeout(function(){ p.textContent = translate('aiError'); p.style.opacity = '1'; }, 180);
      }
      btn.disabled = false;
    });

    var actions = document.createElement('div'); actions.className = 'insight-actions';
    var sources = document.createElement('button'); sources.type = 'button'; sources.className = 'text-action';
    sources.textContent = translate('viewSourceEntries');
    sources.addEventListener('click', function(){ openHistoryRange(range, formatPeriodLabel(insightsPeriod, range)); });
    var write = document.createElement('button'); write.type = 'button'; write.className = 'text-action';
    write.textContent = translate('writeAboutThis'); write.addEventListener('click', function(){ openWritingFromInsight(false); });
    actions.appendChild(sources); actions.appendChild(write);
    card.appendChild(requirement); card.appendChild(btn); card.appendChild(p); card.appendChild(actions);
    return card;
  }

  var insightsPeriod = 'week';
  var insightsAnchor = new Date();
  var corrSelectedId = null;
  var PERIOD_TYPE_KEY = { week:'periodWeek', month:'periodMonth', year:'periodYear' };
  var PERIOD_JUMP_KEY = { week:'jumpWeek', month:'jumpMonth', year:'jumpYear' };

  function periodSummaryText(summary){
    var lang = state.profile.lang;
    if(!summary.entryCount){
      return lang === 'he'
        ? 'עדיין אין רשומות בתקופה הזו. רשומה אחת תתחיל לבנות תמונה.'
        : 'There are no entries in this period yet. One entry will start building the picture.';
    }
    if(lang === 'he'){
      var entryCopy = 'כתבת ' + summary.entryCount + ' רשומות';
      var dayCopy = summary.activeDays === 1 ? 'כולן ביום אחד' : 'על פני ' + summary.activeDays + ' ימים';
      var moodCopy = summary.moodCount < 3
        ? 'עדיין אין מספיק נתוני מצב רוח לזיהוי דפוס.'
        : 'יש מספיק נתוני מצב רוח לתמונה ראשונית.';
      return entryCopy + ', ' + dayCopy + '. ' + moodCopy;
    }
    var entriesCopy = 'You wrote ' + summary.entryCount + (summary.entryCount === 1 ? ' entry' : ' entries');
    var daysCopy = summary.activeDays === 1 ? 'all on one day' : 'across ' + summary.activeDays + ' days';
    var moodCopyEn = summary.moodCount < 3
      ? 'There is not enough mood data to identify a pattern yet.'
      : 'There is enough mood data for an early picture.';
    return entriesCopy + ', ' + daysCopy + '. ' + moodCopyEn;
  }

  function renderInsights(){
    var host = document.getElementById('insights-content');
    host.innerHTML = '';

    var periodRow = document.createElement('div'); periodRow.className = 'pillrow period-row';
    ['week','month','year'].forEach(function(p){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pill'+(insightsPeriod===p?' active':'');
      b.textContent = translate(PERIOD_TYPE_KEY[p]);
      b.setAttribute('aria-pressed', String(insightsPeriod === p));
      b.addEventListener('click', function(){ insightsPeriod = p; renderInsights(); });
      periodRow.appendChild(b);
    });
    host.appendChild(periodRow);

    var range = periodRange(insightsPeriod, insightsAnchor);

    var navHeader = document.createElement('div'); navHeader.className = 'cal-header';
    var navTitle = document.createElement('div'); navTitle.className = 'cal-title';
    navTitle.textContent = formatPeriodLabel(insightsPeriod, range);

    var navWrap = document.createElement('div'); navWrap.className = 'cal-nav';
    if(!isCurrentPeriod(insightsPeriod, insightsAnchor)){
      var jumpBtn = document.createElement('button'); jumpBtn.className = 'cal-today-btn';
      jumpBtn.textContent = translate(PERIOD_JUMP_KEY[insightsPeriod]);
      jumpBtn.addEventListener('click', function(){ insightsAnchor = new Date(); renderInsights(); });
      navWrap.appendChild(jumpBtn);
    }
    var prevBtn = document.createElement('button'); prevBtn.className = 'icon-btn cal-nav-btn';
    prevBtn.innerHTML = SVG_CHEVRON_LEFT;
    prevBtn.setAttribute('aria-label', translate('previousPeriod'));
    prevBtn.addEventListener('click', function(){ shiftAnchor(insightsPeriod, -1); renderInsights(); });
    var nextBtn = document.createElement('button'); nextBtn.className = 'icon-btn cal-nav-btn';
    nextBtn.innerHTML = SVG_CHEVRON_RIGHT;
    nextBtn.setAttribute('aria-label', translate('nextPeriod'));
    nextBtn.disabled = isCurrentPeriod(insightsPeriod, insightsAnchor);
    nextBtn.addEventListener('click', function(){ shiftAnchor(insightsPeriod, 1); renderInsights(); });
    navWrap.appendChild(prevBtn); navWrap.appendChild(nextBtn);

    navHeader.appendChild(navTitle); navHeader.appendChild(navWrap);
    host.appendChild(navHeader);

    var periodEntries = entriesInRange(range);
    var summary = summarizeEntries(periodEntries);
    var previousSummary = summarizeEntries(entriesInRange(previousPeriodRange(insightsPeriod, range)));

    var narrative = document.createElement('section'); narrative.className = 'period-narrative';
    var narrativeTitle = document.createElement('h1'); narrativeTitle.textContent = translate('periodOverviewTitle');
    var narrativeText = document.createElement('p'); narrativeText.textContent = periodSummaryText(summary);
    narrative.appendChild(narrativeTitle); narrative.appendChild(narrativeText); host.appendChild(narrative);

    var overviewTitle = document.createElement('h2'); overviewTitle.className = 'section-title'; overviewTitle.textContent = translate('quickOverviewTitle');
    host.appendChild(overviewTitle);
    var statRow = document.createElement('div'); statRow.className = 'stat-row';
    statRow.appendChild(statCard(summary.entryCount, translate('entriesLabel'), signedComparison(summary.entryCount, previousSummary.entryCount), function(){ openHistoryRange(range, formatPeriodLabel(insightsPeriod, range)); }));
    var activeDaysLabel = summary.activeDays === 1 ? translate('activeDayLabel') : translate('activeDaysLabel');
    statRow.appendChild(statCard(summary.activeDays, activeDaysLabel, signedComparison(summary.activeDays, previousSummary.activeDays), function(){ openHistoryRange(range, formatPeriodLabel(insightsPeriod, range)); }));
    var moodDetail = summary.moodCount + ' / 3 ' + translate('moodChecksLabel');
    statRow.appendChild(statCard(summary.avgMood!==null ? summary.avgMood.toFixed(1) : '—', translate('avgLabel'), moodDetail, summary.moodCount ? function(){ openHistoryRange(range, formatPeriodLabel(insightsPeriod, range)); } : function(){ openWritingFromInsight(true); }));
    host.appendChild(statRow);

    host.appendChild(renderHorizonChart(insightsPeriod, range));

    var reflectTitle = document.createElement('h2'); reflectTitle.className = 'section-title'; reflectTitle.textContent = translate('reflectionTitle');
    host.appendChild(reflectTitle);
    host.appendChild(renderReflectCard(range, summary));

    renderHabitsInsightsSection(host, range);
    renderCorrelationsSection(host);
  }

  function renderHabitsInsightsSection(host){
    var title = document.createElement('h2'); title.className = 'section-title'; title.textContent = translate('insightsHabitsTitle');
    host.appendChild(title);

    if(!state.habits.length){
      var empty = document.createElement('div'); empty.className = 'insight-empty-action compact';
      var emptyCopy = document.createElement('div'); emptyCopy.className = 'insight-empty-copy'; emptyCopy.textContent = translate('habitsInsightEmpty');
      var add = document.createElement('button'); add.type = 'button'; add.className = 'secondary-action'; add.textContent = translate('habitAddBtn');
      add.addEventListener('click', function(){ switchToPanel('habits'); });
      empty.appendChild(emptyCopy); empty.appendChild(add); host.appendChild(empty); return;
    }

    var dueTodayCount = state.habits.filter(function(h){ return h.trackMode === 'elapsed' || isHabitDueToday(h); }).length;
    var doneTodayCount = state.habits.filter(function(h){ return habitCheckedToday(h); }).length;
    var streaks = state.habits.map(habitStreak).filter(function(s){ return s !== null; });
    var bestStreak = streaks.length ? Math.max.apply(null, streaks) : 0;

    var statRow = document.createElement('div'); statRow.className = 'stat-row';
    statRow.appendChild(statCard('\u2066'+doneTodayCount+'/'+dueTodayCount+'\u2069', translate('habitsCompletedToday'), translate('openHabitsAction'), function(){ switchToPanel('habits'); }));
    statRow.appendChild(statCard(bestStreak, translate('habitsBestStreak')));
    statRow.appendChild(statCard(state.habits.length, translate('habitsTotalLabel')));
    host.appendChild(statRow);

    state.habits.slice().sort(function(a,b){ return (a.createdAt||0)-(b.createdAt||0); }).forEach(function(habit){
      var row = document.createElement('button'); row.type = 'button'; row.className = 'habit-insight-row';
      var nameEl = document.createElement('div'); nameEl.className = 'habit-insight-name'; nameEl.textContent = habit.name;
      var statEl = document.createElement('div'); statEl.className = 'habit-insight-stat';
      if(habit.trackMode === 'simple'){
        statEl.classList.add('streak');
        statEl.textContent = habitStreak(habit) + ' ' + translate('streakLabel');
      } else {
        statEl.textContent = habitElapsedLabel(habit);
      }
      row.appendChild(nameEl); row.appendChild(statEl);
      row.addEventListener('click', function(){ switchToPanel('habits'); });
      host.appendChild(row);
    });
  }

  function buildCorrDayMap(){
    var dm = {};
    state.entries.forEach(function(e){
      if(!dm[e.date]) dm[e.date] = {moods:[], hasNote:false, done:{}};
      if(typeof e.mood === 'number') dm[e.date].moods.push(e.mood);
      if((e.note && e.note.trim()) || (e.messages && e.messages.length > 1)) dm[e.date].hasNote = true;
    });
    state.habits.forEach(function(h){
      (h.completions||[]).forEach(function(d){
        if(!dm[d]) dm[d] = {moods:[], hasNote:false, done:{}};
        dm[d].done[h.id] = true;
      });
    });
    return dm;
  }

  function computeCorrelationFor(itemId, dm){
    var moodDays = Object.keys(dm).filter(function(d){ return dm[d].moods.length > 0; });
    function avg(arr){ return arr.reduce(function(s,d){ var ms=dm[d].moods; return s+ms.reduce(function(a,b){return a+b;},0)/ms.length; },0)/arr.length; }
    var done, notDone, MIN = 4;
    if(itemId === 'writing'){
      done = moodDays.filter(function(d){ return dm[d].hasNote; });
      notDone = moodDays.filter(function(d){ return !dm[d].hasNote; });
    } else {
      done = moodDays.filter(function(d){ return dm[d].done[itemId]; });
      notDone = moodDays.filter(function(d){ return !dm[d].done[itemId]; });
    }
    if(done.length < MIN || notDone.length < MIN){
      return {ready:false, doneDays:done.length, notDoneDays:notDone.length, required:MIN};
    }
    var avgDone = avg(done), avgNotDone = avg(notDone);
    return {ready:true, avgDone:avgDone, avgNotDone:avgNotDone, diff:avgDone-avgNotDone, doneDays:done.length, notDoneDays:notDone.length};
  }

  function renderCorrelationsSection(host){
    var wrapper = document.createElement('div');
    host.appendChild(wrapper);
    renderCorrInner(wrapper);
  }

  function renderCorrInner(wrapper){
    wrapper.innerHTML = '';
    var lang = state.profile.lang;
    var items = state.habits.map(function(h){ return {id:h.id, name:h.name}; });
    items.push({id:'writing', name:translate('corrWriting')});

    var title = document.createElement('h2');
    title.className = 'section-title'; title.textContent = translate('corrTitle');
    wrapper.appendChild(title);

    if(!corrSelectedId || !items.some(function(i){ return i.id === corrSelectedId; })) corrSelectedId = items[0].id;

    var pillRow = document.createElement('div'); pillRow.className = 'pillrow';
    items.forEach(function(item){
      var b = document.createElement('button'); b.type = 'button';
      b.className = 'pill' + (corrSelectedId === item.id ? ' active' : '');
      b.textContent = item.name;
      b.addEventListener('click', function(){ corrSelectedId = item.id; renderCorrInner(wrapper); });
      pillRow.appendChild(b);
    });
    wrapper.appendChild(pillRow);

    var dm = buildCorrDayMap();
    var corr = computeCorrelationFor(corrSelectedId, dm);
    var card = document.createElement('div'); card.className = 'reflect-card';

    if(!corr.ready){
      var p = document.createElement('p');
      p.style.margin = '0'; p.style.color = 'var(--ink-soft)'; p.style.fontSize = '0.85rem';
      p.textContent = translate('corrExactRequirement')
        .replace('{with}', corr.doneDays)
        .replace('{without}', corr.notDoneDays);
      card.appendChild(p);
    } else {
      var lead = document.createElement('p'); lead.className = 'corr-lead';
      lead.textContent = translate('corrObservationLead'); card.appendChild(lead);
      [[corr.avgDone, translate('corrWith'), corr.doneDays],[corr.avgNotDone, translate('corrWithout'), corr.notDoneDays]].forEach(function(triple){
        var val = triple[0], label = triple[1], days = triple[2];
        var row = document.createElement('div'); row.className = 'corr-bar-row';
        var lbl = document.createElement('span'); lbl.className = 'corr-bar-label'; lbl.textContent = label;
        var track = document.createElement('div'); track.className = 'corr-bar-track';
        var fill = document.createElement('div'); fill.className = 'corr-bar-fill';
        fill.style.width = Math.round((val/(MOOD_STEPS-1))*100)+'%';
        fill.style.background = moodColor(val);
        track.appendChild(fill);
        var valEl = document.createElement('span'); valEl.className = 'corr-bar-val'; valEl.textContent = val.toFixed(1);
        var moodLbl = document.createElement('span'); moodLbl.className = 'corr-mood-lbl';
        moodLbl.textContent = MOOD_LABELS[lang][Math.round(val)] + ' · ' + days + (lang==='he' ? ' ימ׳' : 'd');
        row.appendChild(lbl); row.appendChild(track); row.appendChild(valEl); row.appendChild(moodLbl);
        card.appendChild(row);
      });
      var delta = document.createElement('div'); delta.className = 'corr-delta';
      var sign = corr.diff > 0 ? '+' : '';
      delta.textContent = sign + corr.diff.toFixed(1) + ' ' + (lang==='he' ? 'נקודות · ביטחון נמוך' : 'pts · low confidence');
      card.appendChild(delta);
      var note = document.createElement('p'); note.className = 'corr-note'; note.textContent = translate('corrNotCausal'); card.appendChild(note);
    }
    wrapper.appendChild(card);
  }

  /* ============ Habits ============ */
  var editingHabitId = null; // null while creating a new habit; set while editing an existing one
  var notifyPermissionAsked = false;

  function habitDow(dateObj){ return dateObj.getDay(); }

  function isHabitDueToday(habit, dateObj){
    dateObj = dateObj || new Date();
    if(habit.frequency === 'days'){
      return (habit.daysOfWeek||[]).indexOf(habitDow(dateObj)) !== -1;
    }
    if(habit.frequency === 'interval'){
      var last = habit.lastDoneAt ? new Date(habit.lastDoneAt) : new Date(habit.createdAt);
      var diffDays = Math.floor((stripTime(dateObj) - stripTime(last)) / 86400000);
      return diffDays >= Math.max(1, habit.intervalDays||1);
    }
    return true; // daily
  }
  function stripTime(d){ var x = new Date(d); x.setHours(0,0,0,0); return x; }

  function habitDoneToday(habit){
    return (habit.completions||[]).indexOf(todayStr()) !== -1;
  }

  function habitCheckedToday(habit){
    if(habit.trackMode === 'elapsed'){
      if(!habit.lastDoneAt) return false;
      return stripTime(new Date(habit.lastDoneAt)).getTime() === stripTime(new Date()).getTime();
    }
    return habitDoneToday(habit);
  }

  function habitElapsedLabel(habit){
    var lang = state.profile.lang;
    if(!habit.lastDoneAt) return translate('habitNotDoneYet');
    var diffDays = Math.floor((stripTime(new Date()) - stripTime(new Date(habit.lastDoneAt))) / 86400000);
    if(diffDays <= 0) return translate('habitToday');
    if(diffDays === 1) return translate('habitOneDayAgo');
    if(diffDays === 2) return translate('habitTwoDaysAgo');
    return (lang==='he' ? (translate('habitDaysAgoPrefix')+' '+diffDays+' '+translate('habitDaysAgoSuffix')) : (diffDays+' '+translate('habitDaysAgoSuffix')));
  }

  function habitStatusLabel(habit){
    if(habit.trackMode === 'elapsed') return habitElapsedLabel(habit);
    var due = isHabitDueToday(habit);
    if(habitDoneToday(habit)) return translate('habitDoneToday');
    return due ? scheduleSummaryLabel(habit) : translate('habitNotDueToday');
  }

  function scheduleSummaryLabel(habit){
    var lang = state.profile.lang;
    if(habit.frequency === 'daily') return translate('habitFreqDaily');
    if(habit.frequency === 'interval') return (lang==='he' ? (translate('habitIntervalPrefix')+' '+habit.intervalDays+' '+translate('habitIntervalSuffix')) : (translate('habitIntervalPrefix')+' '+habit.intervalDays+' '+translate('habitIntervalSuffix')));
    var names = (habit.daysOfWeek||[]).slice().sort().map(function(d){ return WD_SHORT[lang][d]; });
    return names.join(', ');
  }

  function habitStreak(habit){
    // Only simple/repeating habits keep a completions history; elapsed-mode habits
    // only store a single lastDoneAt with no past record, so a streak isn't meaningful there.
    if(habit.trackMode !== 'simple') return null;
    var streak = 0;
    var d = new Date(); d.setHours(0,0,0,0);
    if(isHabitDueToday(habit, d) && !habitDoneToday(habit)){
      d.setDate(d.getDate()-1); // grace: don't break the streak just because today isn't done yet
    }
    var createdDate = stripTime(new Date(habit.createdAt||0));
    var guard = 0;
    while(d >= createdDate && guard < 2000){
      guard++;
      if(isHabitDueToday(habit, d)){
        var key = todayStr(d);
        if((habit.completions||[]).indexOf(key) !== -1) streak++;
        else break;
      }
      d.setDate(d.getDate()-1);
    }
    return streak;
  }

  var habitUndoTimer = null;

  function showHabitUndo(habitId, wasChecked){
    var panel = document.getElementById('panel-habits');
    var existing = panel.querySelector('.habit-undo-toast');
    if(existing) existing.remove();
    clearTimeout(habitUndoTimer);
    var toast = document.createElement('div'); toast.className = 'habit-undo-toast'; toast.setAttribute('role', 'status');
    var copy = document.createElement('span'); copy.textContent = translate(wasChecked ? 'habitCompletionRemoved' : 'habitCompletionSaved');
    var undo = document.createElement('button'); undo.type = 'button'; undo.textContent = translate('undoAction');
    undo.addEventListener('click', function(){ toggleHabitDone(habitId, true); toast.remove(); });
    toast.appendChild(copy); toast.appendChild(undo); panel.appendChild(toast);
    habitUndoTimer = setTimeout(function(){ toast.remove(); }, 4500);
  }

  function toggleHabitDone(habitId, suppressToast){
    var habit = state.habits.find(function(h){ return h.id===habitId; });
    if(!habit) return;
    var wasChecked = habitCheckedToday(habit);
    if(habit.trackMode === 'elapsed'){
      var elapsedToday = todayStr();
      habit.completions = habit.completions || [];
      if(habitCheckedToday(habit)){
        // tap again to undo today's check-in, restoring whatever it showed before
        habit.lastDoneAt = (habit.previousLastDoneAt !== undefined) ? habit.previousLastDoneAt : null;
        delete habit.previousLastDoneAt;
        habit.completions = habit.completions.filter(function(date){ return date !== elapsedToday; });
      } else {
        habit.previousLastDoneAt = habit.lastDoneAt || null;
        habit.lastDoneAt = Date.now();
        if(habit.completions.indexOf(elapsedToday) === -1) habit.completions.push(elapsedToday);
      }
    } else {
      var today = todayStr();
      var idx = (habit.completions||[]).indexOf(today);
      habit.completions = habit.completions || [];
      if(idx === -1) habit.completions.push(today);
      else habit.completions.splice(idx, 1); // tap again to undo
    }
    habit.editedAt = Date.now();
    saveState();
    renderHabits();
    renderInsights();
    if(!suppressToast) showHabitUndo(habitId, wasChecked);
  }

  function addSuggestedHabit(template){
    var now = Date.now();
    state.habits.push({
      id:'hb'+now, name:translate(template.nameKey), trackMode:'simple', frequency:template.frequency || 'daily',
      daysOfWeek:template.daysOfWeek || [0,1,2,3,4,5,6], intervalDays:template.intervalDays || 2,
      time:template.time || '', notify:false, lastDoneAt:null, completions:[], notifiedDates:{},
      createdAt:now, editedAt:now
    });
    saveState(); renderHabits(); renderInsights();
  }

  function habitSupplementaryLabel(habit){
    var parts = [];
    if(habit.time) parts.push(habit.time);
    if(habit.trackMode === 'simple'){
      var streak = habitStreak(habit);
      if(streak > 0) parts.push(streak + ' ' + translate('streakLabel'));
    }
    return parts.join(' · ');
  }

  function renderHabitCard(habit){
    var card = document.createElement('div'); card.className = 'habit-card';
    var due = habit.trackMode === 'elapsed' ? true : isHabitDueToday(habit);
    if(!due) card.classList.add('not-due');

    var checkBtn = document.createElement('button');
    checkBtn.type = 'button'; checkBtn.className = 'habit-check-btn';
    var checked = habitCheckedToday(habit);
    if(checked) checkBtn.classList.add('checked');
    checkBtn.setAttribute('aria-pressed', String(checked));
    checkBtn.setAttribute('aria-label', (checked ? translate('markHabitUndone') : translate('markHabitDone')) + ': ' + habit.name);
    checkBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    checkBtn.addEventListener('click', function(){ toggleHabitDone(habit.id); });

    var meta = document.createElement('div'); meta.className = 'habit-meta';
    var nameEl = document.createElement('div'); nameEl.className = 'habit-name'; nameEl.textContent = habit.name;
    var statusEl = document.createElement('div'); statusEl.className = 'habit-status'; statusEl.textContent = habitStatusLabel(habit);
    var extra = habitSupplementaryLabel(habit);
    meta.appendChild(nameEl); meta.appendChild(statusEl);
    if(extra){ var extraEl = document.createElement('div'); extraEl.className = 'habit-extra'; extraEl.textContent = extra; meta.appendChild(extraEl); }

    var editBtn = document.createElement('button'); editBtn.type = 'button'; editBtn.className = 'entry-action-btn edit habit-edit-btn';
    editBtn.setAttribute('aria-label', translate('editHabitAction') + ': ' + habit.name);
    editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>';
    editBtn.addEventListener('click', function(){ openHabitSheet(habit.id); });

    card.appendChild(checkBtn); card.appendChild(meta); card.appendChild(editBtn);
    return card;
  }

  function appendHabitGroup(list, titleText, habits, extraClass){
    if(!habits.length) return;
    var section = document.createElement('section'); section.className = 'habit-group ' + (extraClass || '');
    var title = document.createElement('h2'); title.className = 'habit-group-title'; title.textContent = titleText + ' (' + habits.length + ')';
    section.appendChild(title);
    habits.forEach(function(habit){ section.appendChild(renderHabitCard(habit)); });
    list.appendChild(section);
  }

  function renderHabits(){
    var list = document.getElementById('habits-list');
    list.innerHTML = '';

    var header = document.createElement('div'); header.className = 'habits-header';
    var headingWrap = document.createElement('div');
    var heading = document.createElement('h1'); heading.textContent = translate('habitsTodayTitle');
    var add = document.createElement('button'); add.type = 'button'; add.className = 'add-entry-btn';
    add.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg><span>'+translate('habitAddBtn')+'</span>';
    add.addEventListener('click', function(){ openHabitSheet(null); });
    headingWrap.appendChild(heading); header.appendChild(headingWrap); header.appendChild(add); list.appendChild(header);

    if(!state.habits.length){
      var empty = document.createElement('section'); empty.className = 'habit-empty';
      var emptyTitle = document.createElement('h2'); emptyTitle.textContent = translate('habitStarterTitle');
      var emptyCopy = document.createElement('p'); emptyCopy.textContent = translate('habitsEmpty');
      var suggestions = document.createElement('div'); suggestions.className = 'habit-suggestions';
      [
        {nameKey:'habitTemplateWater', time:'08:00'},
        {nameKey:'habitTemplateWalk'},
        {nameKey:'habitTemplateWrite'},
        {nameKey:'habitTemplateSleep', time:'22:30'}
      ].forEach(function(template){
        var button = document.createElement('button'); button.type = 'button'; button.className = 'habit-suggestion';
        button.textContent = translate(template.nameKey); button.addEventListener('click', function(){ addSuggestedHabit(template); });
        suggestions.appendChild(button);
      });
      var custom = document.createElement('button'); custom.type = 'button'; custom.className = 'habit-suggestion custom'; custom.textContent = translate('habitTemplateCustom');
      custom.addEventListener('click', function(){ openHabitSheet(null); }); suggestions.appendChild(custom);
      empty.appendChild(emptyTitle); empty.appendChild(emptyCopy); empty.appendChild(suggestions);
      list.appendChild(empty);
      return;
    }
    var sorted = state.habits.slice().sort(function(a,b){ return (a.createdAt||0)-(b.createdAt||0); });
    var due = sorted.filter(function(habit){ return (habit.trackMode === 'elapsed' || isHabitDueToday(habit)) && !habitCheckedToday(habit); });
    var completed = sorted.filter(habitCheckedToday);
    var later = sorted.filter(function(habit){ return habit.trackMode !== 'elapsed' && !isHabitDueToday(habit) && !habitCheckedToday(habit); });
    var dueCount = due.length + completed.length;
    var progressText = document.createElement('p'); progressText.className = 'habits-progress-copy';
    progressText.textContent = '\u2066' + completed.length + ' / ' + dueCount + '\u2069 ' + translate('habitsProgressLabel');
    headingWrap.appendChild(progressText);
    var progress = document.createElement('div'); progress.className = 'habits-progress'; progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', String(dueCount)); progress.setAttribute('aria-valuenow', String(completed.length));
    var fill = document.createElement('span'); fill.style.width = (dueCount ? completed.length / dueCount * 100 : 0) + '%'; progress.appendChild(fill); list.appendChild(progress);
    appendHabitGroup(list, translate('habitsDueTitle'), due);
    appendHabitGroup(list, translate('habitsCompletedTitle'), completed, 'completed');
    appendHabitGroup(list, translate('habitsLaterTitle'), later, 'later');
  }

  function defaultHabitDraft(){
    return {
      id: null, name: '', trackMode: 'simple', frequency: 'daily',
      daysOfWeek: [0,1,2,3,4,5,6], intervalDays: 2, time: '', notify: false,
      lastDoneAt: null, completions: [], createdAt: null
    };
  }
  var habitDraft = defaultHabitDraft();

  function renderHabitSheetBody(){
    var host = document.getElementById('habit-sheet-body');
    host.innerHTML = '';

    function syncSaveAvailability(){
      var validName = !!(habitDraft.name || '').trim();
      var validDays = habitDraft.trackMode !== 'simple' || habitDraft.frequency !== 'days' || (habitDraft.daysOfWeek || []).length > 0;
      document.getElementById('habit-save-btn').disabled = !(validName && validDays);
    }

    function choiceButton(label, selected, onClick){
      var button = document.createElement('button'); button.type = 'button'; button.className = 'pill' + (selected ? ' active' : '');
      button.textContent = label; button.setAttribute('aria-pressed', String(selected)); button.addEventListener('click', onClick);
      return button;
    }

    var nameField = document.createElement('div'); nameField.className = 'habit-sheet-field';
    var nameLabel = document.createElement('label'); nameLabel.textContent = translate('habitNameQuestion'); nameLabel.htmlFor = 'habit-name-input';
    var nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.id = 'habit-name-input';
    nameInput.placeholder = translate('habitNamePh'); nameInput.value = habitDraft.name; nameInput.maxLength = 60;
    nameInput.addEventListener('input', function(){ habitDraft.name = nameInput.value; syncSaveAvailability(); });
    nameField.appendChild(nameLabel); nameField.appendChild(nameInput);
    host.appendChild(nameField);

    if(habitDraft.trackMode === 'simple'){
      var freqField = document.createElement('div'); freqField.className = 'habit-sheet-field';
      var freqLabel = document.createElement('div'); freqLabel.className = 'habit-field-label'; freqLabel.textContent = translate('habitFrequencyQuestion');
      var freqRow = document.createElement('div'); freqRow.className = 'pillrow';
      [['daily','habitFreqDaily'],['days','habitFreqDays'],['interval','habitFreqInterval']].forEach(function(pair){
        freqRow.appendChild(choiceButton(translate(pair[1]), habitDraft.frequency === pair[0], function(){ habitDraft.frequency = pair[0]; renderHabitSheetBody(); }));
      });
      freqField.appendChild(freqLabel); freqField.appendChild(freqRow); host.appendChild(freqField);

      if(habitDraft.frequency === 'days'){
        var daysField = document.createElement('div'); daysField.className = 'habit-sheet-field';
        var daysLabel = document.createElement('div'); daysLabel.className = 'habit-field-label'; daysLabel.textContent = translate('habitDaysLabel');
        var daysRow = document.createElement('div'); daysRow.className = 'pillrow day-choice-row';
        WD_SHORT[state.profile.lang].forEach(function(label, dow){
          var active = (habitDraft.daysOfWeek || []).indexOf(dow) !== -1;
          daysRow.appendChild(choiceButton(label, active, function(){
            var index = habitDraft.daysOfWeek.indexOf(dow);
            if(index === -1) habitDraft.daysOfWeek.push(dow); else habitDraft.daysOfWeek.splice(index, 1);
            renderHabitSheetBody();
          }));
        });
        daysField.appendChild(daysLabel); daysField.appendChild(daysRow); host.appendChild(daysField);
      }

      if(habitDraft.frequency === 'interval'){
        var intField = document.createElement('div'); intField.className = 'habit-sheet-field';
        var intRow = document.createElement('div'); intRow.className = 'habit-interval-row';
        var prefixSpan = document.createElement('span'); prefixSpan.textContent = translate('habitIntervalPrefix');
        var intInput = document.createElement('input'); intInput.type = 'number'; intInput.min = 2; intInput.max = 60; intInput.value = habitDraft.intervalDays;
        intInput.setAttribute('aria-label', translate('habitFreqInterval'));
        intInput.addEventListener('input', function(){ habitDraft.intervalDays = Math.max(2, Number(intInput.value) || 2); });
        var suffixSpan = document.createElement('span'); suffixSpan.textContent = translate('habitIntervalSuffix');
        intRow.appendChild(prefixSpan); intRow.appendChild(intInput); intRow.appendChild(suffixSpan); intField.appendChild(intRow); host.appendChild(intField);
      }
    }

    var reminderField = document.createElement('div'); reminderField.className = 'habit-sheet-field reminder-field';
    var reminderTitle = document.createElement('div'); reminderTitle.className = 'habit-field-label'; reminderTitle.textContent = translate('habitReminderOptional');
    reminderField.appendChild(reminderTitle);
    var timeLabel = document.createElement('label'); timeLabel.textContent = translate('habitTimeLabel'); timeLabel.htmlFor = 'habit-time-input';
    var timeInput = document.createElement('input'); timeInput.type = 'time'; timeInput.className = 'habit-time-input';
    timeInput.id = 'habit-time-input';
    timeInput.value = habitDraft.time || '';
    timeInput.addEventListener('input', function(){ habitDraft.time = timeInput.value; });
    reminderField.appendChild(timeLabel); reminderField.appendChild(timeInput);
    var notifyRow = document.createElement('div'); notifyRow.className = 'habit-switch-row';
    var notifyLabel = document.createElement('label'); notifyLabel.textContent = translate('habitNotifyLabel'); notifyLabel.id = 'habit-notify-label';
    var switchWrap = document.createElement('label'); switchWrap.className = 'switch';
    var notifyInput = document.createElement('input'); notifyInput.type = 'checkbox'; notifyInput.checked = !!habitDraft.notify;
    notifyInput.setAttribute('aria-labelledby', 'habit-notify-label');
    var slider = document.createElement('span'); slider.className = 'slider';
    notifyInput.addEventListener('change', function(){
      habitDraft.notify = notifyInput.checked;
      if(habitDraft.notify) requestNotifyPermissionIfNeeded();
      renderHabitSheetBody();
    });
    switchWrap.appendChild(notifyInput); switchWrap.appendChild(slider);
    notifyRow.appendChild(notifyLabel); notifyRow.appendChild(switchWrap);
    reminderField.appendChild(notifyRow);
    if(habitDraft.notify){ var notifyNote = document.createElement('div'); notifyNote.className = 'habit-notify-note'; notifyNote.textContent = translate('habitNotifyNote'); reminderField.appendChild(notifyNote); }
    host.appendChild(reminderField);

    var advanced = document.createElement('details'); advanced.className = 'habit-advanced'; advanced.open = habitDraft.trackMode === 'elapsed';
    var advancedSummary = document.createElement('summary'); advancedSummary.textContent = translate('habitAdvancedTitle'); advanced.appendChild(advancedSummary);
    var modeLabel = document.createElement('div'); modeLabel.className = 'habit-field-label'; modeLabel.textContent = translate('habitTrackingQuestion');
    var modeRow = document.createElement('div'); modeRow.className = 'habit-mode-options';
    [['simple','habitModeSimple'],['elapsed','habitModeElapsed']].forEach(function(pair){
      var option = choiceButton(translate(pair[1]), habitDraft.trackMode === pair[0], function(){ habitDraft.trackMode = pair[0]; renderHabitSheetBody(); });
      option.classList.add('habit-mode-option'); modeRow.appendChild(option);
    });
    var modeHelp = document.createElement('p'); modeHelp.className = 'habit-notify-note'; modeHelp.textContent = translate(habitDraft.trackMode === 'elapsed' ? 'habitModeElapsedHelp' : 'habitModeSimpleHelp');
    advanced.appendChild(modeLabel); advanced.appendChild(modeRow); advanced.appendChild(modeHelp); host.appendChild(advanced);
    syncSaveAvailability();
  }

  function requestNotifyPermissionIfNeeded(){
    if(!('Notification' in window)) return;
    if(Notification.permission === 'default' && !notifyPermissionAsked){
      notifyPermissionAsked = true;
      Notification.requestPermission();
    }
  }

  function openHabitSheet(habitId){
    if(habitId){
      var habit = state.habits.find(function(h){ return h.id===habitId; });
      if(!habit) return;
      editingHabitId = habitId;
      habitDraft = {
        id: habit.id, name: habit.name, trackMode: habit.trackMode, frequency: habit.frequency,
        daysOfWeek: (habit.daysOfWeek||[]).slice(), intervalDays: habit.intervalDays||2,
        time: habit.time||'', notify: !!habit.notify,
        lastDoneAt: habit.lastDoneAt||null, completions: (habit.completions||[]).slice(), createdAt: habit.createdAt
      };
      document.getElementById('habit-sheet-title').textContent = translate('habitEditTitle');
      document.getElementById('habit-delete-btn').style.display = '';
    } else {
      editingHabitId = null;
      habitDraft = defaultHabitDraft();
      document.getElementById('habit-sheet-title').textContent = translate('habitNewTitle');
      document.getElementById('habit-delete-btn').style.display = 'none';
    }
    document.getElementById('habit-save-btn').textContent = translate('habitSave');
    document.getElementById('habit-delete-btn').textContent = translate('habitDelete');
    document.getElementById('habit-sheet-close-btn').textContent = translate('close');
    renderHabitSheetBody();
    document.getElementById('sheet-backdrop').classList.add('open');
    var sheet = document.getElementById('habit-sheet');
    sheet.removeAttribute('inert'); sheet.setAttribute('aria-hidden', 'false'); sheet.classList.add('open');
    setTimeout(function(){ var input = document.getElementById('habit-name-input'); if(input) input.focus(); }, 0);
  }

  function closeHabitSheet(){
    var sheet = document.getElementById('habit-sheet');
    sheet.classList.remove('open'); sheet.setAttribute('aria-hidden', 'true'); sheet.setAttribute('inert', '');
    closeBackdropIfNoSheetsOpen();
  }

  function saveHabitFromSheet(){
    var name = (habitDraft.name||'').trim();
    if(!name) return;
    if(habitDraft.frequency === 'days' && !(habitDraft.daysOfWeek||[]).length) return;
    if(editingHabitId){
      var habit = state.habits.find(function(h){ return h.id===editingHabitId; });
      if(!habit) return;
      habit.name = name;
      habit.trackMode = habitDraft.trackMode;
      habit.frequency = habitDraft.frequency;
      habit.daysOfWeek = habitDraft.daysOfWeek;
      habit.intervalDays = habitDraft.intervalDays;
      habit.time = habitDraft.time;
      habit.notify = habitDraft.notify;
      habit.editedAt = Date.now();
    } else {
      state.habits.push({
        id: 'hb'+Date.now(), name: name, trackMode: habitDraft.trackMode, frequency: habitDraft.frequency,
        daysOfWeek: habitDraft.daysOfWeek, intervalDays: habitDraft.intervalDays, time: habitDraft.time,
        notify: habitDraft.notify, lastDoneAt: null, completions: [], notifiedDates: {},
        createdAt: Date.now(), editedAt: Date.now()
      });
    }
    saveState();
    renderHabits();
    closeHabitSheet();
  }

  function deleteHabit(){
    if(!editingHabitId) return;
    if(!confirm(translate('habitDeleteConfirm'))) return;
    state.habits = state.habits.filter(function(h){ return h.id !== editingHabitId; });
    saveState();
    renderHabits();
    closeHabitSheet();
  }

  document.getElementById('habit-save-btn').addEventListener('click', saveHabitFromSheet);
  document.getElementById('habit-delete-btn').addEventListener('click', deleteHabit);
  document.getElementById('habit-sheet-close-btn').addEventListener('click', closeHabitSheet);

  function checkHabitNotifications(){
    if(!('Notification' in window) || Notification.permission !== 'granted') return;
    var now = new Date();
    var hh = String(now.getHours()).padStart(2,'0');
    var mm = String(now.getMinutes()).padStart(2,'0');
    var nowHM = hh+':'+mm;
    var today = todayStr();
    state.habits.forEach(function(habit){
      if(!habit.notify || !habit.time) return;
      if(habit.time !== nowHM) return;
      habit.notifiedDates = habit.notifiedDates || {};
      if(habit.notifiedDates[today]) return;
      var due = habit.trackMode === 'elapsed' ? true : isHabitDueToday(habit, now);
      if(!due) return;
      if(habit.trackMode !== 'elapsed' && habitDoneToday(habit)) return;
      habit.notifiedDates[today] = true;
      saveState();
      var title = 'Ofek';
      var body = habit.name;
      if(navigator.serviceWorker && navigator.serviceWorker.controller){
        navigator.serviceWorker.ready.then(function(reg){ reg.showNotification(title, {body: body, icon: 'assets/icons/icon-192.png'}); }).catch(function(){
          try{ new Notification(title, {body: body, icon: 'assets/icons/icon-192.png'}); }catch(e){}
        });
      } else {
        try{ new Notification(title, {body: body, icon: 'assets/icons/icon-192.png'}); }catch(e){}
      }
    });
  }
  setInterval(checkHabitNotifications, 30000);

  /* ============ Ribbon ============ */
  function updateRibbon(){
    var today = todayStr();
    var moods = state.entries.filter(function(e){ return e.date===today && typeof e.mood==='number'; }).map(function(e){ return e.mood; });
    var ribbon = document.getElementById('ribbon');
    if(moods.length){
      var avg = moods.reduce(function(a,b){ return a+b; },0)/moods.length;
      ribbon.style.background = moodColor(avg);
      ribbon.classList.remove('ambient');
    } else {
      ribbon.style.background = '';
      ribbon.classList.add('ambient');
    }
  }

  /* ============ Language toggle + settings ============ */
  function highlightLangToggle(){
    document.querySelectorAll('.lang-btn').forEach(function(b){
      b.classList.toggle('active', b.dataset.lang===state.profile.lang);
    });
  }
  document.querySelectorAll('.lang-btn').forEach(function(b){
    b.addEventListener('click', function(){ switchLang(b.dataset.lang); });
  });

  function switchLang(lang){
    state.profile.lang = lang;
    saveState();
    applyLangDir();
    renderStaticLabels();
    renderGreeting();
    renderHistory();
    renderInsights();
    highlightLangToggle();
    renderSettingsLangRow();
  }

  function renderSettingsLangRow(){
    var row = document.getElementById('settings-lang-row');
    row.innerHTML = '';
    [['he','עברית'],['en','English']].forEach(function(pair){
      var b = document.createElement('button');
      b.className = 'pill'+(state.profile.lang===pair[0]?' active':'');
      b.textContent = pair[1];
      b.addEventListener('click', function(){ switchLang(pair[0]); });
      row.appendChild(b);
    });
  }

  document.querySelectorAll('.settings-btn').forEach(function(b){
    b.addEventListener('click', openSettings);
  });
  document.getElementById('sheet-close-btn').addEventListener('click', closeSettings);
  function openSettings(){
    document.getElementById('settings-sheet').classList.add('open');
    document.getElementById('sheet-backdrop').classList.add('open');
    screenLock.renderSettings();
  }
  function closeBackdropIfNoSheetsOpen(){
    var anyOpen = ['settings-sheet','edit-entry-sheet','grounding-disclaimer-sheet','habit-sheet','pin-setup-sheet'].some(function(id){
      var el = document.getElementById(id);
      return el && el.classList.contains('open');
    });
    if(!anyOpen) document.getElementById('sheet-backdrop').classList.remove('open');
  }
  function closeSettings(){
    document.getElementById('settings-sheet').classList.remove('open');
    closeBackdropIfNoSheetsOpen();
    var newName = document.getElementById('settings-name').value.trim();
    if(newName) state.profile.name = newName;
    saveState();
    renderGreeting();
  }

  /* ============ Edit / add entry ============ */
  var editingEntryId = null;
  var editingImage = null; // data URL or null (controls whether to update image on save)
  var editingMode = 'edit'; // 'edit' or 'add'
  var editingTargetDate = null; // for add mode, the YYYY-MM-DD to write the entry to

  function openEditEntry(entryId){
    var entry = state.entries.find(function(e){ return e.id === entryId; });
    if(!entry) return;
    editingMode = 'edit';
    editingEntryId = entryId;
    editingImage = entry.image || null; // start with existing image
    editingTargetDate = entry.date;
    var lang = state.profile.lang;
    var sheet = document.getElementById('edit-entry-sheet');
    document.getElementById('sheet-backdrop').classList.add('open');
    sheet.classList.add('open');
    // hide flow picker when editing (flow is fixed for existing entries)
    // localize
    document.getElementById('edit-entry-title').textContent = lang === 'he' ? 'עריכת רשומה' : 'Edit entry';
    document.getElementById('edit-mood-label').textContent = lang === 'he' ? 'מצב רוח' : 'Mood';
    document.getElementById('edit-note-label').textContent = lang === 'he' ? 'הערה' : 'Note';
    document.getElementById('edit-image-label').textContent = lang === 'he' ? 'תמונה' : 'Image';
    document.getElementById('edit-image-btn-label').textContent = lang === 'he' ? (entry.image ? 'החלף תמונה' : 'הוסף תמונה') : (entry.image ? 'Replace photo' : 'Add photo');
    document.getElementById('edit-save-btn').textContent = lang === 'he' ? 'שמור שינויים' : 'Save changes';
    document.getElementById('edit-delete-btn').style.display = '';
    document.getElementById('edit-delete-btn').textContent = lang === 'he' ? 'מחק' : 'Delete';
    document.getElementById('edit-sheet-close-btn').textContent = lang === 'he' ? 'סגירה' : 'Close';
    document.getElementById('edit-note').placeholder = lang === 'he' ? 'הערה (לא חובה)' : 'Note (optional)';
    // meta
    var flowLabel = translate(FLOW_KEY[entry.flow] || 'flowChat');
    document.getElementById('edit-entry-meta').textContent = (lang === 'he' ? 'מתוך ' : 'From ') + formatDate(entry.date) + ' · ' + entry.time + ' · ' + flowLabel;
    // mood
    var moodVal = (typeof entry.mood === 'number') ? entry.mood : 7;
    var slider = document.getElementById('edit-moodslider');
    slider.value = String(moodVal);
    var labelEl = document.getElementById('edit-moodlabel');
    labelEl.textContent = MOOD_LABELS[lang][moodVal];
    labelEl.style.color = moodColor(moodVal);
    document.getElementById('edit-moodface').innerHTML = moodFaceSVG(moodVal, moodColor(moodVal), 44);
    // note
    document.getElementById('edit-note').value = entry.note || '';
    autoGrowTextarea(document.getElementById('edit-note'));
    // image
    refreshEditImageThumb();
  }

  function openAddEntry(dateKey){
    editingMode = 'add';
    editingEntryId = null;
    editingImage = null;
    editingTargetDate = dateKey;
    var lang = state.profile.lang;
    var sheet = document.getElementById('edit-entry-sheet');
    document.getElementById('sheet-backdrop').classList.add('open');
    sheet.classList.add('open');
    // localize
    document.getElementById('edit-entry-title').textContent = lang === 'he' ? 'רשומה חדשה ליום הזה' : 'New entry for this day';
    document.getElementById('edit-mood-label').textContent = lang === 'he' ? 'מצב רוח' : 'Mood';
    document.getElementById('edit-note-label').textContent = lang === 'he' ? 'הערה' : 'Note';
    document.getElementById('edit-image-label').textContent = lang === 'he' ? 'תמונה' : 'Image';
    document.getElementById('edit-image-btn-label').textContent = lang === 'he' ? 'הוסף תמונה' : 'Add photo';
    document.getElementById('edit-delete-btn').style.display = 'none';
    document.getElementById('edit-sheet-close-btn').textContent = lang === 'he' ? 'ביטול' : 'Cancel';
    document.getElementById('edit-save-btn').textContent = lang === 'he' ? 'הוסף רשומה' : 'Add entry';
    document.getElementById('edit-note').placeholder = lang === 'he' ? 'הערה (לא חובה)' : 'Note (optional)';
    // meta - just show the date
    document.getElementById('edit-entry-meta').textContent = (lang === 'he' ? 'ליום ' : 'For ') + formatDate(dateKey);
    // mood default to neutral
    var slider = document.getElementById('edit-moodslider');
    slider.value = '7';
    var labelEl = document.getElementById('edit-moodlabel');
    labelEl.textContent = MOOD_LABELS[lang][7];
    labelEl.style.color = moodColor(7);
    document.getElementById('edit-moodface').innerHTML = moodFaceSVG(7, moodColor(7), 44);
    // clear note
    document.getElementById('edit-note').value = '';
    autoGrowTextarea(document.getElementById('edit-note'));
    // image empty
    refreshEditImageThumb();
  }

  function refreshEditImageThumb(){
    var thumb = document.getElementById('edit-image-thumb');
    var preview = document.getElementById('edit-image-preview');
    var btn = document.getElementById('edit-image-btn');
    if(editingImage){
      preview.src = editingImage;
      thumb.style.display = '';
      btn.classList.add('has-image');
    } else {
      preview.src = '';
      thumb.style.display = 'none';
      btn.classList.remove('has-image');
    }
  }

  function closeEditEntry(){
    document.getElementById('edit-entry-sheet').classList.remove('open');
    closeBackdropIfNoSheetsOpen();
    editingEntryId = null;
    editingImage = null;
  }

  function saveEditEntry(){
    var moodVal = Number(document.getElementById('edit-moodslider').value);
    var noteText = document.getElementById('edit-note').value.trim();
    if(editingMode === 'add'){
      if(!editingTargetDate) return;
      var now = new Date();
      var newEntryId = 'e'+Date.now();
      var entry = {
        id: newEntryId,
        date: editingTargetDate,
        time: timeStr(now),
        flow: 'chat',
        mood: (Number.isFinite(moodVal)) ? moodVal : null,
        note: noteText || undefined,
        createdAt: Date.now()
      };
      if(editingImage) entry.image = editingImage;
      state.entries.push(entry);
      // After adding, switch to "show all" filter so the user can see their new entry
      selectedDate = null;
      saveState();
      updateRibbon();
      renderCalendar();
      renderHistory();
      renderInsights();
      closeEditEntry();
      showEntrySavedToast(false);
      return;
    }
    if(!editingEntryId) return;
    var entry = state.entries.find(function(e){ return e.id === editingEntryId; });
    if(!entry) return;
    entry.mood = (Number.isFinite(moodVal)) ? moodVal : null;
    entry.note = noteText || undefined;
    delete entry.summary;
    if(editingImage){
      entry.image = editingImage;
    } else {
      delete entry.image;
    }
    entry.editedAt = Date.now();
    saveState();
    updateRibbon();
    renderHistory();
    renderInsights();
    closeEditEntry();
    showEntrySavedToast(false);
  }

  function deleteEntry(entryId){
    var entry = state.entries.find(function(e){ return e.id === entryId; });
    if(!entry) return;
    var lang = state.profile.lang;
    var msg = lang === 'he'
      ? 'למחוק את הרשומה הזאת? אי אפשר לשחזר.'
      : 'Delete this entry? This cannot be undone.';
    if(!confirm(msg)) return;
    state.entries = state.entries.filter(function(e){ return e.id !== entryId; });
    state.weeklyCache = {};
    saveState();
    updateRibbon();
    renderHistory();
    renderInsights();
    if(editingEntryId === entryId) closeEditEntry();
  }

  // Edit entry sheet wiring
  var editMoodSlider = document.getElementById('edit-moodslider');
  if(editMoodSlider){
    editMoodSlider.addEventListener('input', function(){
      var v = Number(this.value);
      var lang = state.profile ? state.profile.lang : 'he';
      var c = moodColor(v);
      var labelEl = document.getElementById('edit-moodlabel');
      labelEl.textContent = MOOD_LABELS[lang][v];
      labelEl.style.color = c;
      document.getElementById('edit-moodface').innerHTML = moodFaceSVG(v, c, 44);
    });
  }
  var editImageBtn = document.getElementById('edit-image-btn');
  var editImageInput = document.getElementById('edit-image-input');
  if(editImageBtn && editImageInput){
    editImageBtn.addEventListener('click', function(){ editImageInput.click(); });
    editImageInput.addEventListener('change', function(){
      var file = editImageInput.files && editImageInput.files[0];
      if(!file) return;
      window.OfekImages.readAndCompress(file).then(function(dataUrl){
        editingImage = dataUrl;
        refreshEditImageThumb();
        editImageInput.value = '';
      }).catch(function(){
        var lang = state.profile ? state.profile.lang : 'he';
        alert(lang === 'he' ? 'לא הצלחתי לטעון את התמונה.' : "Couldn't load that image.");
        editImageInput.value = '';
      });
    });
  }
  var editImageRemove = document.getElementById('edit-image-remove');
  if(editImageRemove){
    editImageRemove.addEventListener('click', function(){
      editingImage = null;
      refreshEditImageThumb();
    });
  }
  var editSaveBtn = document.getElementById('edit-save-btn');
  if(editSaveBtn) editSaveBtn.addEventListener('click', saveEditEntry);
  var editDeleteBtn = document.getElementById('edit-delete-btn');
  if(editDeleteBtn) editDeleteBtn.addEventListener('click', function(){
    if(editingEntryId) deleteEntry(editingEntryId);
  });
  var editSheetClose = document.getElementById('edit-sheet-close-btn');
  if(editSheetClose) editSheetClose.addEventListener('click', closeEditEntry);

  /* ============ Grounding chat (distress button) ============ */
  function openGroundingDisclaimer(){
    document.getElementById('grounding-disclaimer-sheet').classList.add('open');
    document.getElementById('sheet-backdrop').classList.add('open');
  }
  function closeGroundingDisclaimer(){
    document.getElementById('grounding-disclaimer-sheet').classList.remove('open');
    closeBackdropIfNoSheetsOpen();
  }
  var groundingBtn = document.getElementById('grounding-btn');
  if(groundingBtn) groundingBtn.addEventListener('click', openGroundingDisclaimer);
  var groundingCancelBtn = document.getElementById('grounding-cancel-btn');
  if(groundingCancelBtn) groundingCancelBtn.addEventListener('click', closeGroundingDisclaimer);
  var groundingContinueBtn = document.getElementById('grounding-continue-btn');
  if(groundingContinueBtn) groundingContinueBtn.addEventListener('click', function(){
    closeGroundingDisclaimer();
    openFlow('grounding');
  });

  // Backdrop closes whichever sheet is open
  document.getElementById('sheet-backdrop').addEventListener('click', function(){
    if(document.getElementById('pin-setup-sheet').classList.contains('open')){
      if(!state.security.pinHash) state.security.lockEnabled = false;
      screenLock.closeSetup();
      screenLock.renderSettings();
    }
    else if(document.getElementById('edit-entry-sheet').classList.contains('open')) closeEditEntry();
    else if(document.getElementById('grounding-disclaimer-sheet').classList.contains('open')) closeGroundingDisclaimer();
    else if(document.getElementById('settings-sheet').classList.contains('open')) closeSettings();
  });

  document.getElementById('clear-data-btn').addEventListener('click', function(){
    if(confirm(translate('clearConfirm'))){
      state.entries = [];
      dailySummaries.clear();
      state.weeklyCache = {};
      state.habits = [];
      saveState();
      renderHistory();
      renderInsights();
      renderHabits();
      updateRibbon();
    }
  });

  /* ============ Service worker ============ */
  function registerSW(){
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('sw.js').catch(function(){});
      var refreshed = false;
      navigator.serviceWorker.addEventListener('controllerchange', function(){
        if(refreshed) return;
        refreshed = true;
        window.location.reload();
      });
    }
  }

  function renderStateViews(){
    applyLangDir();
    renderStaticLabels();
    renderGreeting();
    renderHistory();
    renderInsights();
    renderHabits();
    updateRibbon();
  }

  cloudSync = window.OfekCloudSync.create({
    getState:function(){ return state; },
    persistState:window.OfekStorage.replace,
    translate:translate,
    formatTime:timeStr,
    onStateMerged:renderStateViews
  });

  function renderAfterImport(){
    renderStateViews();
    highlightLangToggle();
    renderSettingsLangRow();
    document.getElementById('settings-name').value = state.profile.name || '';
  }

  window.OfekDataTransfer.bind({
    getState:function(){ return state; },
    saveState:saveState,
    translate:translate,
    todayKey:todayStr,
    onImported:renderAfterImport
  });

  screenLock = window.OfekScreenLock.create({
    getState:function(){ return state; },
    saveState:saveState,
    translate:translate,
    genderVariant:genderVariant,
    closeBackdrop:closeBackdropIfNoSheetsOpen
  });

  /* ============ Init ============ */
  if(state.profile && state.profile.onboarded){
    document.getElementById('onboarding').style.display = 'none';
    startApp();
    screenLock.checkAndShow();
  } else {
    renderOnboarding();
  }

})().catch(function(error){
  console.error('[Ofek] App startup failed', error);
  var status = document.getElementById('storage-status');
  if(status){
    status.textContent = document.documentElement.lang === 'en'
      ? 'Ofek could not start. Refresh the page to try again.'
      : 'אופק לא הצליח להיפתח. אפשר לרענן את העמוד ולנסות שוב.';
    status.hidden = false;
  }
});
