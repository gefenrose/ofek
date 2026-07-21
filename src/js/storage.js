(function(){
  'use strict';

  var DB_NAME = 'ofek_data_v1';
  var STORE_NAME = 'app';
  var STATE_ID = 'state';
  var LEGACY_KEY = 'ofek_state_v1';
  var PREFS_KEY = 'ofek_prefs_v1';
  var writeQueue = Promise.resolve();

  function defaultState(){
    return { profile:null, entries:[], daySummaries:{}, weeklyCache:{}, habits:[] };
  }

  function showError(error){
    var lang = document.documentElement.lang === 'en' ? 'en' : 'he';
    var el = document.getElementById('storage-status');
    if(el){
      el.textContent = lang === 'en'
        ? 'Ofek could not save your latest change. Export your data and free device storage before continuing.'
        : 'אופק לא הצליח לשמור את השינוי האחרון. מומלץ לייצא את הנתונים ולפנות מקום במכשיר לפני שממשיכים.';
      el.hidden = false;
    }
    window.dispatchEvent(new CustomEvent('ofek-storage-error', { detail: { message: String(error && error.message || error) } }));
  }

  function clearError(){
    var el = document.getElementById('storage-status');
    if(el){ el.hidden = true; el.textContent = ''; }
  }

  function openDatabase(){
    return new Promise(function(resolve, reject){
      if(!window.indexedDB){ reject(new Error('IndexedDB unavailable')); return; }
      var request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function(){
        var db = request.result;
        if(!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = function(){ resolve(request.result); };
      request.onerror = function(){ reject(request.error || new Error('Could not open IndexedDB')); };
    });
  }

  function transact(mode, action){
    return openDatabase().then(function(db){
      return new Promise(function(resolve, reject){
        var transaction = db.transaction(STORE_NAME, mode);
        var store = transaction.objectStore(STORE_NAME);
        var result;
        var request = action(store);
        request.onsuccess = function(){ result = request.result; };
        request.onerror = function(){ reject(request.error || new Error('Storage transaction failed')); };
        transaction.oncomplete = function(){ db.close(); resolve(result); };
        transaction.onerror = function(){ reject(transaction.error || new Error('Storage transaction failed')); db.close(); };
        transaction.onabort = function(){ reject(transaction.error || new Error('Storage transaction aborted')); db.close(); };
      });
    });
  }

  function readLegacyState(){
    var raw = localStorage.getItem(LEGACY_KEY);
    if(!raw) return null;
    try{ return JSON.parse(raw); }
    catch(error){
      try{ localStorage.setItem(LEGACY_KEY + '_recovery_' + Date.now(), raw); }catch(ignore){}
      throw error;
    }
  }

  function savePreferences(state){
    var prefs = {
      theme: state && state.theme || 'auto',
      lang: state && state.profile && state.profile.lang || document.documentElement.lang || 'he'
    };
    try{ localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }catch(ignore){}
  }

  function requestPersistentStorage(){
    if(!navigator.storage || !navigator.storage.persist) return;
    navigator.storage.persisted().then(function(isPersistent){
      if(!isPersistent) return navigator.storage.persist();
    }).catch(function(){ /* Persistence is an optimization; IndexedDB still works without it. */ });
  }

  async function load(){
    requestPersistentStorage();
    try{
      var stored = await transact('readonly', function(store){ return store.get(STATE_ID); });
      if(stored) return stored;
      var legacy = readLegacyState();
      if(legacy){
        await transact('readwrite', function(store){ return store.put(legacy, STATE_ID); });
        savePreferences(legacy);
        localStorage.removeItem(LEGACY_KEY);
        return legacy;
      }
      return defaultState();
    }catch(error){
      showError(error);
      try{ return readLegacyState() || defaultState(); }catch(ignore){ return defaultState(); }
    }
  }

  function cloneState(state){
    if(window.structuredClone) return window.structuredClone(state);
    return JSON.parse(JSON.stringify(state));
  }

  function save(state){
    var snapshot = cloneState(state);
    savePreferences(snapshot);
    var task = writeQueue.catch(function(){}).then(function(){
      return transact('readwrite', function(store){ return store.put(snapshot, STATE_ID); });
    }).then(function(result){ clearError(); return result; }).catch(function(error){
      showError(error);
      throw error;
    });
    writeQueue = task.catch(function(){});
    return task;
  }

  function replace(state){ return save(state); }

  window.OfekStorage = { load:load, save:save, replace:replace };
})();
