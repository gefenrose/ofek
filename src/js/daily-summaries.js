(function(){
  'use strict';

  function create(options){
    var getState = options.getState;
    var saveState = options.saveState;
    var askCompanion = options.askCompanion;
    var moodLabels = options.moodLabels;
    var flowLabel = options.flowLabel;
    var formatDate = options.formatDate;
    var firstPersonNote = options.firstPersonNote || function(){ return ''; };
    var onUpdated = options.onUpdated;
    var jobs = {};
    var failedFingerprints = {};

    function messageText(message){
      return String(message && (message.text || message.content) || '').trim();
    }

    function originalEntryText(entry, language){
      var parts = [];
      if(typeof entry.mood === 'number') parts.push(moodLabels[language][entry.mood]);
      if(entry.note) parts.push(String(entry.note).trim());
      (entry.messages || []).forEach(function(message){
        var text = messageText(message);
        if(!text) return;
        var role = message.role === 'ai' || message.role === 'assistant'
          ? (language === 'he' ? 'אופק' : 'Ofek')
          : (language === 'he' ? 'אני' : 'Me');
        parts.push(role + ': ' + text);
      });
      if(!parts.length && entry.summary) parts.push(String(entry.summary).trim());
      return parts.filter(Boolean).join(' · ');
    }

    function sourceFingerprint(date, entries, language){
      var source = JSON.stringify({
        date:date,
        language:language,
        entries:entries.map(function(entry){
          return {
            id:entry.id,
            time:entry.time,
            flow:entry.flow,
            mood:entry.mood,
            note:entry.note || '',
            messages:(entry.messages || []).map(function(message){
              return { role:message.role, text:messageText(message) };
            }),
            summary:(!entry.note && !(entry.messages || []).length) ? entry.summary || '' : ''
          };
        })
      });
      var hash = 2166136261;
      for(var index = 0; index < source.length; index++){
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(36);
    }

    function fallbackSummary(entries, language){
      return entries.map(function(entry){
        return entry.summary || originalEntryText(entry, language);
      }).filter(Boolean).join(' · ');
    }

    function promptFor(date, entries, language){
      var dateLabel = formatDate(date);
      var source = entries.map(function(entry, index){
        var details = originalEntryText(entry, language);
        return (index + 1) + '. ' + entry.time + ' · ' + flowLabel(entry.flow) + '\n' + (details || '—');
      }).join('\n\n');
      var system = (language === 'he'
        ? 'את/ה מסכם/ת יום ביומן אישי. כתוב/כתבי רשומת יום אחת, טבעית וקוהרנטית, בגוף ראשון ובאורך 2–4 משפטים. חובה להתבסס על כל הרשומות שסופקו, לחבר ביניהן בעדינות, ולא להמציא עובדות. אין להזכיר את מספר הרשומות, את תהליך הסיכום או את המילים "המשתמש" ו"הרשומות".'
        : 'You summarize a full day in a personal journal. Write one natural, cohesive first-person daily entry in 2–4 sentences. Use every supplied entry, connect them gently, and do not invent facts. Do not mention the number of entries, the summarization process, "the user", or "the entries".') + firstPersonNote();
      var user = language === 'he'
        ? 'סכם/י את היום ' + dateLabel + ' לפי כל התוכן הבא:\n\n' + source
        : 'Summarize ' + dateLabel + ' using all of the following content:\n\n' + source;
      return { system:system, user:user };
    }

    function generate(date, entries, fingerprint, language){
      var prompt = promptFor(date, entries, language);
      jobs[date] = askCompanion(prompt.system, [{ role:'user', content:prompt.user }]).then(function(text){
        text = String(text || '').trim();
        if(!text) throw new Error('Empty daily summary');
        var state = getState();
        var currentEntries = state.entries.filter(function(entry){ return entry.date === date; })
          .sort(function(a,b){ return a.time.localeCompare(b.time); });
        if(sourceFingerprint(date, currentEntries, language) !== fingerprint) return;
        state.daySummaries = state.daySummaries || {};
        state.daySummaries[date] = {
          text:text,
          fingerprint:fingerprint,
          language:language,
          updatedAt:Date.now()
        };
        delete failedFingerprints[date];
        saveState();
        onUpdated(date);
      }).catch(function(){
        failedFingerprints[date] = fingerprint;
        onUpdated(date);
      }).finally(function(){
        delete jobs[date];
      });
    }

    function get(date, entries){
      var state = getState();
      var language = state.profile.lang;
      var fingerprint = sourceFingerprint(date, entries, language);
      var cached = state.daySummaries && state.daySummaries[date];
      if(cached && cached.fingerprint === fingerprint && cached.language === language){
        return { text:cached.text, status:'ready' };
      }
      if(!jobs[date] && failedFingerprints[date] !== fingerprint){
        generate(date, entries.slice(), fingerprint, language);
      }
      return {
        text:fallbackSummary(entries, language),
        status:failedFingerprints[date] === fingerprint ? 'fallback' : 'loading'
      };
    }

    function retryFailed(){
      failedFingerprints = {};
      onUpdated();
    }

    function clear(){
      var state = getState();
      state.daySummaries = {};
      failedFingerprints = {};
    }

    return { get:get, retryFailed:retryFailed, clear:clear };
  }

  window.OfekDailySummaries = { create:create };
})();
