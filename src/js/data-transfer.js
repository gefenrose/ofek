(function(){
  'use strict';

  function bind(options){
    var getState = options.getState;
    var saveState = options.saveState;
    var translate = options.translate;
    var todayKey = options.todayKey;
    var onImported = options.onImported;
    var fileInput = document.getElementById('import-file-input');

    function exportData(){
      var payload = {
        app:'ofek',
        version:1,
        exportedAt:new Date().toISOString(),
        data:getState()
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'ofek-backup-' + todayKey() + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
    }

    function normalizedImport(parsed){
      var incoming = parsed && parsed.data ? parsed.data : parsed;
      if(!incoming || !incoming.profile || !Array.isArray(incoming.entries)) return null;
      return {
        profile:incoming.profile,
        entries:incoming.entries,
        daySummaries:incoming.daySummaries || {},
        weeklyCache:incoming.weeklyCache || {},
        habits:Array.isArray(incoming.habits) ? incoming.habits : []
      };
    }

    function applyImport(incoming){
      var state = getState();
      state.profile = incoming.profile;
      state.entries = incoming.entries;
      state.daySummaries = incoming.daySummaries;
      state.weeklyCache = incoming.weeklyCache;
      state.habits = incoming.habits;
      saveState();
      onImported();
    }

    function readImport(event){
      var file = event.target.files && event.target.files[0];
      if(!file) return;
      var reader = new FileReader();
      reader.onload = function(){
        try{
          var incoming = normalizedImport(JSON.parse(reader.result));
          if(!incoming) throw new Error('Unsupported backup format');
          if(confirm(translate('importConfirm'))){
            applyImport(incoming);
            alert(translate('importSuccess'));
          }
        }catch(error){
          alert(translate('importError'));
        }finally{
          fileInput.value = '';
        }
      };
      reader.onerror = function(){
        alert(translate('importError'));
        fileInput.value = '';
      };
      reader.readAsText(file);
    }

    document.getElementById('export-data-btn').addEventListener('click', exportData);
    document.getElementById('import-data-btn').addEventListener('click', function(){ fileInput.click(); });
    fileInput.addEventListener('change', readImport);
  }

  window.OfekDataTransfer = { bind:bind };
})();
