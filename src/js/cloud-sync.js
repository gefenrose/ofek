(function(){
  'use strict';

  var CLIENT_ID = '39942627897-frvug310j9qrkm79vc58vqu3qndrv3t9.apps.googleusercontent.com';
  var SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  var FILE_NAME = 'ofek-sync.json';
  var CONFIG_KEY = 'ofek_drive_v1';
  var SYNC_DELAY_MS = 2500;

  function create(options){
    var getState = options.getState;
    var persistState = options.persistState;
    var translate = options.translate;
    var formatTime = options.formatTime;
    var onStateMerged = options.onStateMerged;

    var config = loadConfig();
    var accessToken = null;
    var tokenClient = null;
    var syncInProgress = false;
    var syncTimer = null;

    function loadConfig(){
      try{
        var raw = localStorage.getItem(CONFIG_KEY);
        return raw ? JSON.parse(raw) : defaultConfig();
      }catch(error){
        return defaultConfig();
      }
    }

    function defaultConfig(){
      return { connected:false, fileId:null, lastSyncedAt:null };
    }

    function saveConfig(){
      try{ localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); }
      catch(error){ console.warn('[Ofek] Could not save Google Drive preferences', error); }
    }

    function isConfigured(){
      return CLIENT_ID && !CLIENT_ID.includes('YOUR_GOOGLE_OAUTH_CLIENT_ID');
    }

    function getTokenClient(){
      if(tokenClient) return tokenClient;
      var oauth = window.google && window.google.accounts && window.google.accounts.oauth2;
      if(!oauth) return null;
      tokenClient = oauth.initTokenClient({
        client_id:CLIENT_ID,
        scope:SCOPE,
        callback:function(response){
          if(!response || !response.access_token){ setStatus('error'); return; }
          accessToken = response.access_token;
          config.connected = true;
          saveConfig();
          render();
          syncNow();
        },
        error_callback:function(){ setStatus('error'); }
      });
      return tokenClient;
    }

    function connect(){
      var client = isConfigured() && getTokenClient();
      if(!client){ alert(translate('driveUnavailable')); return; }
      client.requestAccessToken({ prompt:'consent' });
    }

    function silentlyAuthenticate(){
      if(!isConfigured() || !config.connected) return;
      var client = getTokenClient();
      if(client) client.requestAccessToken({ prompt:'' });
    }

    function disconnect(){
      if(!confirm(translate('driveDisconnectConfirm'))) return;
      config = defaultConfig();
      accessToken = null;
      saveConfig();
      render();
    }

    function setStatus(status){
      var row = document.getElementById('drive-status-row');
      var label = document.getElementById('drive-status-text');
      if(!row || !label) return;
      if(status === 'syncing'){
        row.className = 'drive-status is-syncing';
        label.textContent = translate('driveStatusSyncing');
      } else if(status === 'error'){
        row.className = 'drive-status is-error';
        label.textContent = translate('driveStatusError');
      } else if(config.lastSyncedAt){
        row.className = 'drive-status is-synced';
        label.textContent = translate('driveStatusSynced') + ' ' + formatTime(new Date(config.lastSyncedAt));
      } else {
        row.className = 'drive-status';
        label.textContent = translate('driveStatusNever');
      }
    }

    function render(){
      var disconnected = document.getElementById('drive-sync-disconnected');
      var connected = document.getElementById('drive-sync-connected');
      if(!disconnected || !connected) return;
      disconnected.style.display = config.connected ? 'none' : '';
      connected.style.display = config.connected ? '' : 'none';
      if(config.connected) setStatus();
    }

    function authorizationHeaders(){
      return { Authorization:'Bearer ' + accessToken };
    }

    async function findRemoteFile(){
      var query = encodeURIComponent("name='" + FILE_NAME + "'");
      var response = await fetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,modifiedTime)&q=' + query, {
        headers:authorizationHeaders()
      });
      if(!response.ok) throw new Error('Google Drive list failed: ' + response.status);
      var data = await response.json();
      return data.files && data.files[0] || null;
    }

    async function download(fileId){
      var response = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', {
        headers:authorizationHeaders()
      });
      if(!response.ok) throw new Error('Google Drive download failed: ' + response.status);
      return response.json();
    }

    function multipartBody(boundary, metadata, content){
      var delimiter = '\r\n--' + boundary + '\r\n';
      return delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' + JSON.stringify(content) +
        '\r\n--' + boundary + '--';
    }

    async function upload(payload, fileId){
      var boundary = 'ofek_sync_' + Date.now();
      var metadata = fileId ? {} : { name:FILE_NAME, parents:['appDataFolder'] };
      var url = fileId
        ? 'https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=multipart'
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
      var response = await fetch(url, {
        method:fileId ? 'PATCH' : 'POST',
        headers:Object.assign({ 'Content-Type':'multipart/related; boundary=' + boundary }, authorizationHeaders()),
        body:multipartBody(boundary, metadata, payload)
      });
      if(!response.ok) throw new Error('Google Drive upload failed: ' + response.status);
      var data = await response.json();
      return data.id;
    }

    function mergeCollection(localItems, remoteItems){
      var byId = {};
      (localItems || []).forEach(function(item){ byId[item.id] = item; });
      (remoteItems || []).forEach(function(item){
        var existing = byId[item.id];
        if(!existing){ byId[item.id] = item; return; }
        var existingTime = existing.editedAt || existing.createdAt || 0;
        var incomingTime = item.editedAt || item.createdAt || 0;
        if(incomingTime > existingTime) byId[item.id] = item;
      });
      return Object.keys(byId).map(function(id){ return byId[id]; });
    }

    function mergeState(local, remote){
      var remoteIsNewer = (remote.lastModified || 0) > (local.lastModified || 0);
      return {
        profile:remoteIsNewer ? remote.profile || local.profile : local.profile,
        entries:mergeCollection(local.entries, remote.entries),
        habits:mergeCollection(local.habits, remote.habits),
        daySummaries:remoteIsNewer ? remote.daySummaries || local.daySummaries : local.daySummaries,
        weeklyCache:remoteIsNewer ? remote.weeklyCache || local.weeklyCache : local.weeklyCache,
        lastModified:Math.max(local.lastModified || 0, remote.lastModified || 0, Date.now())
      };
    }

    function applyMergedState(target, merged){
      var changed = JSON.stringify(target.entries) !== JSON.stringify(merged.entries) ||
        JSON.stringify(target.habits) !== JSON.stringify(merged.habits) ||
        JSON.stringify(target.profile) !== JSON.stringify(merged.profile) ||
        JSON.stringify(target.daySummaries) !== JSON.stringify(merged.daySummaries);
      target.profile = merged.profile;
      target.entries = merged.entries;
      target.habits = merged.habits;
      target.daySummaries = merged.daySummaries;
      target.weeklyCache = merged.weeklyCache;
      target.lastModified = merged.lastModified;
      return changed;
    }

    function schedule(){
      if(!config.connected) return;
      clearTimeout(syncTimer);
      syncTimer = setTimeout(syncNow, SYNC_DELAY_MS);
    }

    async function syncNow(){
      if(!config.connected || syncInProgress) return;
      if(!accessToken){ silentlyAuthenticate(); return; }
      syncInProgress = true;
      setStatus('syncing');
      try{
        var state = getState();
        var remoteFile = config.fileId ? { id:config.fileId } : await findRemoteFile();
        if(remoteFile){
          config.fileId = remoteFile.id;
          saveConfig();
          var changed = applyMergedState(state, mergeState(state, await download(remoteFile.id) || {}));
          await persistState(state);
          if(changed) onStateMerged();
          await upload(state, remoteFile.id);
        } else {
          state.lastModified = state.lastModified || Date.now();
          config.fileId = await upload(state, null);
          saveConfig();
        }
        config.lastSyncedAt = Date.now();
        saveConfig();
        setStatus();
      }catch(error){
        if(String(error.message).includes('401')) accessToken = null;
        setStatus('error');
      }finally{
        syncInProgress = false;
      }
    }

    function bindEvents(){
      document.getElementById('drive-connect-btn').addEventListener('click', connect);
      document.getElementById('drive-sync-now-btn').addEventListener('click', syncNow);
      document.getElementById('drive-disconnect-btn').addEventListener('click', disconnect);
    }

    bindEvents();
    render();
    if(config.connected) silentlyAuthenticate();
    return { render:render, schedule:schedule, syncNow:syncNow };
  }

  window.OfekCloudSync = { create:create };
})();
