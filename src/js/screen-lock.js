(function(){
  'use strict';

  var PIN_LENGTH = 4;
  var CURRENT_PIN_KDF = 'pbkdf2-sha256-210k';
  var BIOMETRIC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 11v3.5a2.5 2.5 0 0 1-2.5 2.5"></path><path d="M6.5 9.5a5.5 5.5 0 0 1 11 0V12"></path><path d="M4 12V9.5a8 8 0 0 1 15.9-1.2"></path><path d="M9 9.5v3.5a3 3 0 0 0 5.2 2"></path><path d="M16.5 9.5v4a6.5 6.5 0 0 1-1.4 4.1"></path><path d="M3.5 14a8 8 0 0 0 2.6 5.3"></path></svg>';

  function create(options){
    var getState = options.getState;
    var saveState = options.saveState;
    var translate = options.translate;
    var genderVariant = options.genderVariant;
    var closeBackdrop = options.closeBackdrop;

    var unlocked = false;
    var pinBuffer = '';
    var pendingSetupPin = null;
    var setupMode = null;

    function state(){ return getState(); }
    function language(){ return state().profile && state().profile.lang || 'he'; }

    function bufferToBase64(buffer){
      var bytes = new Uint8Array(buffer);
      var binary = '';
      for(var index = 0; index < bytes.byteLength; index++) binary += String.fromCharCode(bytes[index]);
      return btoa(binary);
    }

    function base64ToBuffer(value){
      var binary = atob(value);
      var bytes = new Uint8Array(binary.length);
      for(var index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      return bytes.buffer;
    }

    function randomBase64(byteLength){
      var bytes = new Uint8Array(byteLength);
      crypto.getRandomValues(bytes);
      return bufferToBase64(bytes.buffer);
    }

    async function hashPin(pin, saltBase64, algorithm){
      var encoder = new TextEncoder();
      if(algorithm !== CURRENT_PIN_KDF){
        var legacyHash = await crypto.subtle.digest('SHA-256', encoder.encode(saltBase64 + ':' + pin));
        return bufferToBase64(legacyHash);
      }
      var key = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
      var hash = await crypto.subtle.deriveBits({
        name:'PBKDF2',
        salt:new Uint8Array(base64ToBuffer(saltBase64)),
        iterations:210000,
        hash:'SHA-256'
      }, key, 256);
      return bufferToBase64(hash);
    }

    function supportsBiometrics(){
      return !!(window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable);
    }

    async function biometricsAvailable(){
      if(!supportsBiometrics()) return false;
      try{ return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
      catch(error){ return false; }
    }

    async function registerBiometric(){
      if(!supportsBiometrics()) throw new Error('Biometrics unavailable');
      var currentState = state();
      var userId = currentState.security.credentialUserId || randomBase64(16);
      var credential = await navigator.credentials.create({
        publicKey:{
          challenge:crypto.getRandomValues(new Uint8Array(32)),
          rp:{ name:'Ofek' },
          user:{
            id:base64ToBuffer(userId),
            name:currentState.profile.name || 'ofek-user',
            displayName:currentState.profile.name || 'Ofek user'
          },
          pubKeyCredParams:[{ type:'public-key', alg:-7 }, { type:'public-key', alg:-257 }],
          authenticatorSelection:{ authenticatorAttachment:'platform', userVerification:'required' },
          timeout:60000
        }
      });
      currentState.security.credentialId = bufferToBase64(credential.rawId);
      currentState.security.credentialUserId = userId;
      currentState.security.biometricEnabled = true;
      saveState();
    }

    async function verifyBiometric(){
      var credentialId = state().security.credentialId;
      if(!credentialId) throw new Error('No biometric credential');
      var assertion = await navigator.credentials.get({
        publicKey:{
          challenge:crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials:[{ type:'public-key', id:base64ToBuffer(credentialId) }],
          userVerification:'required',
          timeout:60000
        }
      });
      return !!assertion;
    }

    function renderDots(hostId){
      var host = document.getElementById(hostId);
      if(!host) return;
      host.querySelectorAll('.pin-dot').forEach(function(dot, index){
        dot.classList.toggle('filled', index < pinBuffer.length);
      });
    }

    function buildKeypad(hostId, handlers){
      var host = document.getElementById(hostId);
      if(!host) return;
      host.replaceChildren();
      ['1','2','3','4','5','6','7','8','9','biometric','0','backspace'].forEach(function(key){
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'pin-key';
        if(key === 'biometric'){
          button.className += ' pin-key-bio';
          button.innerHTML = BIOMETRIC_ICON;
          button.setAttribute('aria-label', translate('lockUseBiometric'));
          button.style.visibility = handlers.showBiometric ? '' : 'hidden';
          button.addEventListener('click', handlers.onBiometric || function(){});
        } else if(key === 'backspace'){
          button.className += ' pin-key-back';
          button.setAttribute('aria-label', language() === 'he' ? 'מחיקה' : 'Backspace');
          button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"></path><line x1="18" y1="9" x2="12" y2="15"></line><line x1="12" y1="9" x2="18" y2="15"></line></svg>';
          button.addEventListener('click', handlers.onBackspace);
        } else {
          button.textContent = key;
          button.addEventListener('click', function(){ handlers.onDigit(key); });
        }
        host.appendChild(button);
      });
    }

    function showLockScreen(){
      var currentState = state();
      document.getElementById('lock-screen').style.display = 'flex';
      document.getElementById('lock-title-text').textContent = translate('lockTitle');
      document.getElementById('lock-sub-text').textContent = language() === 'he'
        ? genderVariant('הזן קוד לפתיחה','הזיני קוד לפתיחה',translate('lockSub'))
        : translate('lockSub');
      document.getElementById('lock-pin-error').textContent = '';
      pinBuffer = '';
      renderDots('lock-pin-dots');
      var canUseBiometrics = currentState.security.biometricEnabled && supportsBiometrics();
      buildKeypad('lock-keypad', {
        onDigit:handleUnlockDigit,
        onBackspace:handleUnlockBackspace,
        onBiometric:attemptBiometricUnlock,
        showBiometric:canUseBiometrics
      });
      if(canUseBiometrics) setTimeout(attemptBiometricUnlock, 400);
    }

    function hideLockScreen(){
      document.getElementById('lock-screen').style.display = 'none';
      unlocked = true;
      pinBuffer = '';
    }

    async function attemptBiometricUnlock(){
      try{ if(await verifyBiometric()) hideLockScreen(); }
      catch(error){ /* Keep the PIN keypad available when biometrics are cancelled. */ }
    }

    function handleUnlockDigit(digit){
      if(pinBuffer.length >= PIN_LENGTH) return;
      pinBuffer += digit;
      renderDots('lock-pin-dots');
      if(pinBuffer.length === PIN_LENGTH) verifyPin();
    }

    function handleUnlockBackspace(){
      pinBuffer = pinBuffer.slice(0, -1);
      renderDots('lock-pin-dots');
    }

    async function verifyPin(){
      var currentState = state();
      var enteredPin = pinBuffer;
      var algorithm = currentState.security.pinKdf || 'legacy-sha256';
      var candidate = await hashPin(enteredPin, currentState.security.pinSalt, algorithm);
      if(candidate === currentState.security.pinHash){
        if(algorithm !== CURRENT_PIN_KDF){
          var newSalt = randomBase64(16);
          currentState.security.pinSalt = newSalt;
          currentState.security.pinHash = await hashPin(enteredPin, newSalt, CURRENT_PIN_KDF);
          currentState.security.pinKdf = CURRENT_PIN_KDF;
          saveState();
        }
        hideLockScreen();
        return;
      }
      document.getElementById('lock-pin-error').textContent = language() === 'he'
        ? genderVariant('קוד שגוי, נסה שוב','קוד שגוי, נסי שוב',translate('lockWrongPin'))
        : translate('lockWrongPin');
      var dots = document.getElementById('lock-pin-dots');
      dots.classList.add('shake');
      setTimeout(function(){ dots.classList.remove('shake'); }, 400);
      pinBuffer = '';
      setTimeout(function(){ renderDots('lock-pin-dots'); }, 150);
    }

    function checkAndShow(){
      if(state().security.lockEnabled && !unlocked){
        showLockScreen();
        return true;
      }
      return false;
    }

    function openSetup(){
      setupMode = 'setup';
      pendingSetupPin = null;
      pinBuffer = '';
      document.getElementById('pin-setup-title').textContent = translate('lockSetupTitle');
      document.getElementById('pin-setup-sub').textContent = language() === 'he'
        ? genderVariant('בחר קוד בן 4 ספרות','בחרי קוד בן 4 ספרות',translate('lockSetupSub'))
        : translate('lockSetupSub');
      document.getElementById('pin-setup-error').textContent = '';
      document.getElementById('pin-setup-cancel-btn').textContent = translate('close');
      buildKeypad('pin-setup-keypad', {
        onDigit:handleSetupDigit,
        onBackspace:handleSetupBackspace,
        showBiometric:false
      });
      renderDots('pin-setup-dots');
      document.getElementById('pin-setup-sheet').classList.add('open');
      document.getElementById('sheet-backdrop').classList.add('open');
    }

    function closeSetup(){
      document.getElementById('pin-setup-sheet').classList.remove('open');
      closeBackdrop();
      setupMode = null;
      pendingSetupPin = null;
      pinBuffer = '';
    }

    function handleSetupDigit(digit){
      if(pinBuffer.length >= PIN_LENGTH) return;
      pinBuffer += digit;
      renderDots('pin-setup-dots');
      if(pinBuffer.length !== PIN_LENGTH) return;
      if(setupMode === 'setup'){
        pendingSetupPin = pinBuffer;
        pinBuffer = '';
        setupMode = 'confirm';
        document.getElementById('pin-setup-title').textContent = translate('lockConfirmTitle');
        document.getElementById('pin-setup-sub').textContent = language() === 'he'
          ? genderVariant('הזן את הקוד שוב','הזיני את הקוד שוב',translate('lockConfirmSub'))
          : translate('lockConfirmSub');
        setTimeout(function(){ renderDots('pin-setup-dots'); }, 120);
        return;
      }
      if(pinBuffer === pendingSetupPin) finishSetup(pinBuffer);
      else resetMismatchedSetup();
    }

    function handleSetupBackspace(){
      pinBuffer = pinBuffer.slice(0, -1);
      renderDots('pin-setup-dots');
    }

    function resetMismatchedSetup(){
      document.getElementById('pin-setup-error').textContent = translate('lockMismatch');
      var dots = document.getElementById('pin-setup-dots');
      dots.classList.add('shake');
      setTimeout(function(){ dots.classList.remove('shake'); }, 400);
      pendingSetupPin = null;
      pinBuffer = '';
      setupMode = 'setup';
      document.getElementById('pin-setup-title').textContent = translate('lockSetupTitle');
      document.getElementById('pin-setup-sub').textContent = language() === 'he'
        ? genderVariant('בחר קוד בן 4 ספרות','בחרי קוד בן 4 ספרות',translate('lockSetupSub'))
        : translate('lockSetupSub');
      setTimeout(function(){ renderDots('pin-setup-dots'); }, 200);
    }

    async function finishSetup(pin){
      var currentState = state();
      var salt = randomBase64(16);
      currentState.security.pinSalt = salt;
      currentState.security.pinHash = await hashPin(pin, salt, CURRENT_PIN_KDF);
      currentState.security.pinKdf = CURRENT_PIN_KDF;
      currentState.security.lockEnabled = true;
      saveState();
      closeSetup();
      renderSettings();
    }

    function renderSettings(){
      var security = state().security;
      document.getElementById('lock-settings-label').textContent = translate('lockSettingsLabel');
      document.getElementById('lock-settings-note').textContent = translate('lockSettingsNote');
      document.getElementById('lock-change-pin-btn').textContent = translate('lockChangePin');
      document.getElementById('lock-biometric-label-el').textContent = translate('lockBiometricLabel');
      document.getElementById('lock-enable-toggle').checked = !!security.lockEnabled;
      document.getElementById('lock-change-pin-btn').style.display = security.lockEnabled ? '' : 'none';
      document.getElementById('lock-biometric-row').style.display = security.lockEnabled ? '' : 'none';
      document.getElementById('lock-biometric-toggle').checked = !!security.biometricEnabled;
    }

    function disableLock(){
      var security = state().security;
      security.lockEnabled = false;
      security.pinHash = null;
      security.pinSalt = null;
      security.pinKdf = null;
      security.biometricEnabled = false;
      security.credentialId = null;
      saveState();
      renderSettings();
    }

    function bindEvents(){
      document.addEventListener('visibilitychange', function(){
        if(document.visibilityState === 'hidden') unlocked = false;
        else if(document.visibilityState === 'visible' && state().profile && state().profile.onboarded) checkAndShow();
      });
      document.getElementById('pin-setup-cancel-btn').addEventListener('click', function(){
        if(!state().security.pinHash) state().security.lockEnabled = false;
        closeSetup();
        renderSettings();
      });
      document.getElementById('lock-enable-toggle').addEventListener('change', function(event){
        if(event.target.checked){ event.target.checked = false; openSetup(); }
        else disableLock();
      });
      document.getElementById('lock-change-pin-btn').addEventListener('click', openSetup);
      document.getElementById('lock-biometric-toggle').addEventListener('change', async function(event){
        if(!event.target.checked){
          state().security.biometricEnabled = false;
          state().security.credentialId = null;
          saveState();
          renderSettings();
          return;
        }
        event.target.checked = false;
        if(!await biometricsAvailable()){
          alert(translate('lockBiometricUnavailable'));
          return;
        }
        try{ await registerBiometric(); renderSettings(); }
        catch(error){ alert(translate('lockBiometricSetupFail')); }
      });
    }

    bindEvents();
    return { checkAndShow:checkAndShow, closeSetup:closeSetup, renderSettings:renderSettings };
  }

  window.OfekScreenLock = { create:create };
})();
