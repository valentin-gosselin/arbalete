'use strict';

// Injecté dans l'onglet actif à l'appel de la recherche rapide (Alt+K) : un calque qui
// assombrit et floute la page, avec la palette d'Arbalète centrée dans un cadre.
// Tout est dans un shadow DOM fermé, pour que la page ne puisse ni le styler ni le lire.
// Relancé alors que le calque est ouvert, il le referme.
(() => {
  const ID = 'arbalete-palette-overlay';
  const existing = document.getElementById(ID);
  if (existing) {
    existing.remove();
    return;
  }

  const host = document.createElement('div');
  host.id = ID;
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(12, 11, 18, 0.38);
      backdrop-filter: blur(6px) saturate(120%);
      animation: fade 0.14s ease-out;
    }
    iframe {
      position: fixed;
      left: 50%;
      top: 16vh;
      z-index: 2147483647;
      width: min(680px, calc(100vw - 32px));
      height: 120px;
      max-height: 72vh;
      border: 0;
      border-radius: 16px;
      background: transparent;
      color-scheme: normal;
      box-shadow: 0 30px 90px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.06);
      transform: translateX(-50%);
      animation: pop 0.16s cubic-bezier(0.2, 0.9, 0.3, 1.2);
    }
    @keyframes fade { from { opacity: 0; } }
    @keyframes pop { from { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(0.97); } }
    @media (prefers-reduced-motion: reduce) { .backdrop, iframe { animation: none; } }
  `;

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const frame = document.createElement('iframe');
  const win = typeof window.arbaleteWindowId === 'number' ? `&win=${window.arbaleteWindowId}` : '';
  frame.src = browser.runtime.getURL(`palette/palette.html?overlay=1${win}`);

  const close = () => {
    host.remove();
    window.removeEventListener('message', onMessage);
  };

  // Messages de la palette : hauteur de son contenu, fermeture.
  function onMessage(event) {
    // On reconnaît la palette à une marque dans le message : dans un script de contenu,
    // ni event.source (enveloppes de sécurité) ni l'origine moz-extension ne sont fiables.
    // Au pire, une page pourrait fermer ou redimensionner le calque : sans conséquence.
    if (!event.data || event.data.from !== 'arbalete-palette') return;
    if (event.data.type === 'arbalete-palette-height') frame.style.height = `${event.data.height}px`;
    if (event.data.type === 'arbalete-palette-close') close();
  }
  window.addEventListener('message', onMessage);
  backdrop.addEventListener('mousedown', close);
  // Le curseur doit être tout de suite dans le champ de recherche : on donne le focus
  // au cadre, puis on demande à la palette de le mettre dans son champ.
  frame.addEventListener('load', () => {
    frame.focus();
    frame.contentWindow.focus();
    frame.contentWindow.postMessage({ type: 'arbalete-palette-focus' }, '*');
  });

  shadow.append(style, backdrop, frame);
  document.documentElement.append(host);
})();
