(function(){
  'use strict';

  var lastFocused = new WeakMap();
  var sheets = Array.prototype.slice.call(document.querySelectorAll('.sheet'));

  function focusable(sheet){
    return Array.prototype.slice.call(sheet.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter(function(el){ return !el.disabled && !el.hidden && el.getAttribute('aria-hidden') !== 'true'; });
  }

  function syncSheet(sheet){
    var open = sheet.classList.contains('open');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    var heading = sheet.querySelector('h2[id]');
    if(heading) sheet.setAttribute('aria-labelledby', heading.id);
    sheet.setAttribute('aria-hidden', open ? 'false' : 'true');
    sheet.toggleAttribute('inert', !open);
    if('inert' in sheet) sheet.inert = !open;
    if(open){
      if(!lastFocused.has(sheet)) lastFocused.set(sheet, document.activeElement);
      requestAnimationFrame(function(){
        var items = focusable(sheet);
        if(items.length && !sheet.contains(document.activeElement)) items[0].focus();
      });
    } else {
      var trigger = lastFocused.get(sheet);
      if(trigger && document.contains(trigger) && typeof trigger.focus === 'function') trigger.focus();
      lastFocused.delete(sheet);
    }
  }

  sheets.forEach(function(sheet){
    syncSheet(sheet);
    new MutationObserver(function(){ syncSheet(sheet); }).observe(sheet, { attributes:true, attributeFilter:['class'] });
  });

  document.addEventListener('keydown', function(event){
    var open = sheets.filter(function(sheet){ return sheet.classList.contains('open'); }).pop();
    if(!open) return;
    if(event.key === 'Escape'){
      var close = open.querySelector('.sheet-close');
      if(close){ event.preventDefault(); close.click(); }
      return;
    }
    if(event.key !== 'Tab') return;
    var items = focusable(open);
    if(!items.length){ event.preventDefault(); return; }
    var first = items[0];
    var last = items[items.length - 1];
    if(event.shiftKey && document.activeElement === first){ event.preventDefault(); last.focus(); }
    else if(!event.shiftKey && document.activeElement === last){ event.preventDefault(); first.focus(); }
  });
})();
