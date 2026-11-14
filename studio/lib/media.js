// Ermittelt im Browser Abmessungen, Dauer und ein Standbild (Vorschau) von Medien.

/** @returns {Promise<{breite:number,hoehe:number}|null>} */
export async function imageInfo(file) {
  try {
    const bmp = await createImageBitmap(file);
    const out = { breite: bmp.width, hoehe: bmp.height };
    bmp.close();
    return out;
  } catch {
    return null;
  }
}

/**
 * Lädt die Metadaten eines Videos und erzeugt ein JPEG-Standbild (bei 10 % der Länge, max. 3 s).
 * Kann der Browser das Video nicht dekodieren, kommt null zurück – dann spielt es vermutlich auch der Player nicht.
 * @returns {Promise<{breite:number,hoehe:number,dauerSekunden:number,poster:Blob}|null>}
 */
export function videoInfo(file, { maxWidth = 1280, timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    let finished = false;
    const finish = (v) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      if (!video.videoWidth) return finish(null);
      video.currentTime = Math.min(3, (video.duration || 0) * 0.1);
    };
    video.onseeked = () => {
      const scale = Math.min(1, maxWidth / video.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        finish(blob ? { breite: video.videoWidth, hoehe: video.videoHeight, dauerSekunden: Math.round(video.duration * 1000) / 1000, poster: blob } : null);
      }, 'image/jpeg', 0.85);
    };
    video.src = url;
  });
}
