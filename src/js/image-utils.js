(function(){
  'use strict';

  var MAX_DIMENSION = 1200;
  var DEFAULT_QUALITY = 0.82;
  var FALLBACK_QUALITY = 0.65;
  var TARGET_DATA_URL_LENGTH = 1500 * 1024;

  function readFile(file){
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onload = function(){ resolve(reader.result); };
      reader.onerror = function(){ reject(new Error('Could not read image')); };
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl){
    return new Promise(function(resolve, reject){
      var image = new Image();
      image.onload = function(){ resolve(image); };
      image.onerror = function(){ reject(new Error('Could not decode image')); };
      image.src = dataUrl;
    });
  }

  function compressedDataUrl(image){
    var scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    var result = canvas.toDataURL('image/jpeg', DEFAULT_QUALITY);
    return result.length > TARGET_DATA_URL_LENGTH
      ? canvas.toDataURL('image/jpeg', FALLBACK_QUALITY)
      : result;
  }

  async function readAndCompress(file){
    if(!file || !file.type || !file.type.startsWith('image/')){
      throw new Error('Selected file is not an image');
    }
    return compressedDataUrl(await loadImage(await readFile(file)));
  }

  window.OfekImages = { readAndCompress:readAndCompress };
})();
