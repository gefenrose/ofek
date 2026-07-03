// Ofek app bootstrapper.
//
// Current architecture:
// - index.html is a thin public shell.
// - src/legacy/monolith.html preserves the former single-file app.
// - app.js loads the preserved app source while the large app is migrated into
//   smaller modules.
//
// This is intentionally a bridge file. New code should live in src/js/ and
// src/css/ instead of being added to the legacy monolith.

(function(){
  'use strict';

  var LEGACY_APP_URL = './src/legacy/monolith.html?v=split-2';

  function setLoaderError(message){
    var el = document.getElementById('ofek-load-error');
    if(el) el.textContent = message;
  }

  function copyAttributes(from, to){
    Array.prototype.slice.call(from.attributes || []).forEach(function(attr){
      to.setAttribute(attr.name, attr.value);
    });
  }

  function shouldCopyHeadNode(node){
    if(node.nodeType !== 1) return false;
    var tag = node.tagName.toLowerCase();

    if(tag === 'title') return false;
    if(tag === 'meta'){
      var name = node.getAttribute('name');
      var charset = node.getAttribute('charset');
      if(charset) return false;
      if(name && ['viewport','theme-color','description','apple-mobile-web-app-capable','apple-mobile-web-app-status-bar-style'].indexOf(name) !== -1) return false;
    }

    if(tag === 'link'){
      var href = node.getAttribute('href') || '';
      if(href === 'manifest.webmanifest' || href === './manifest.webmanifest') return false;
      if(href === 'styles.css' || href === './styles.css') return false;
    }

    if(tag === 'script') return false;
    return true;
  }

  function copyHeadAssets(doc){
    Array.prototype.slice.call(doc.head.children).forEach(function(node){
      if(!shouldCopyHeadNode(node)) return;
      document.head.appendChild(document.importNode(node, true));
    });
  }

  function copyStyleBlocks(doc){
    Array.prototype.slice.call(doc.head.querySelectorAll('style')).forEach(function(styleNode, index){
      var style = document.createElement('style');
      style.setAttribute('data-ofek-legacy-style', String(index));
      style.textContent = styleNode.textContent;
      document.head.appendChild(style);
    });
  }

  function removeScripts(root){
    Array.prototype.slice.call(root.querySelectorAll('script')).forEach(function(script){
      script.parentNode.removeChild(script);
    });
  }

  function executeScript(script){
    return new Promise(function(resolve, reject){
      var next = document.createElement('script');
      copyAttributes(script, next);

      if(script.src){
        next.onload = function(){ resolve(); };
        next.onerror = function(){ reject(new Error('Failed to load script: ' + script.src)); };
        next.src = script.src;
      } else {
        next.textContent = script.textContent;
      }

      document.body.appendChild(next);
      if(!script.src) resolve();
    });
  }

  async function executeScripts(doc){
    var scripts = Array.prototype.slice.call(doc.querySelectorAll('script'));
    for(var i=0; i<scripts.length; i++){
      await executeScript(scripts[i]);
    }
  }

  async function boot(){
    try{
      var response = await fetch(LEGACY_APP_URL, { cache:'no-store' });
      if(!response.ok) throw new Error('Legacy app source returned ' + response.status);

      var html = await response.text();
      var doc = new DOMParser().parseFromString(html, 'text/html');

      document.documentElement.lang = doc.documentElement.lang || document.documentElement.lang;
      document.documentElement.dir = doc.documentElement.dir || document.documentElement.dir;

      copyHeadAssets(doc);
      copyStyleBlocks(doc);

      var bodyClone = doc.body.cloneNode(true);
      removeScripts(bodyClone);
      document.body.innerHTML = bodyClone.innerHTML;

      await executeScripts(doc);
    }catch(error){
      console.error('[Ofek] Failed to boot app', error);
      setLoaderError(document.documentElement.lang === 'en'
        ? 'Ofek could not load. Try refreshing the page.'
        : 'אופק לא הצליח להיטען. נסו לרענן את העמוד.');
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();
