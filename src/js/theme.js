// Apply saved theme before first paint to avoid a flash.
(function(){
  try{
    var state = JSON.parse(localStorage.getItem('ofek_state_v1'));
    document.documentElement.setAttribute('data-theme', (state && state.theme) || 'auto');
  }catch(error){
    document.documentElement.setAttribute('data-theme','auto');
  }
})();
