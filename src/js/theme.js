// Apply saved theme before first paint to avoid a flash.
(function(){
  try{
    var prefs = JSON.parse(localStorage.getItem('ofek_prefs_v1'));
    document.documentElement.setAttribute('data-theme', (prefs && prefs.theme) || 'auto');
  }catch(error){
    document.documentElement.setAttribute('data-theme','auto');
  }
})();
