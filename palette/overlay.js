'use strict';

// Injected in the active tab to show quick search (Alt+K) or one of Arbalète's dialogs
// (space editor, settings, archive…): a layer that dims and blurs the page, with the
// extension page in a frame. Everything lives in a closed shadow DOM, so the page can
// neither style nor read it. Injected again for quick search while it is open, it closes
// it; a new dialog replaces whatever overlay is open.
// window.arbaleteOverlay = { kind: 'dialog', url } is set just before by the background
// script; without it, this is quick search (window.arbaleteWindowId).
(() => {
  const ID = 'arbalete-palette-overlay';
  const config = window.arbaleteOverlay || null;
  window.arbaleteOverlay = null;
  const kind = config ? config.kind : 'palette';

  const existing = document.getElementById(ID);
  if (existing) {
    existing.remove();
    if (existing.dataset.kind === 'palette' && kind === 'palette') return;
  }

  const host = document.createElement('div');
  host.id = ID;
  host.dataset.kind = kind;
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
    iframe.dialog {
      top: 6vh;
      width: min(480px, calc(100vw - 32px));
      height: 240px;
      max-height: 88vh;
      border-radius: 18px;
    }
    @keyframes fade { from { opacity: 0; } }
    @keyframes pop { from { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(0.97); } }
    @media (prefers-reduced-motion: reduce) { .backdrop, iframe { animation: none; } }
  `;

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const frame = document.createElement('iframe');
  if (kind === 'dialog') {
    frame.className = 'dialog';
    frame.src = config.url;
  } else {
    const win = typeof window.arbaleteWindowId === 'number' ? `&win=${window.arbaleteWindowId}` : '';
    frame.src = browser.runtime.getURL(`palette/palette.html?overlay=1${win}`);
  }

  const close = () => {
    host.remove();
    window.removeEventListener('message', onMessage);
  };

  // Messages from the framed page: height of its content, closing.
  function onMessage(event) {
    // The frame is recognized by a mark in the message: in a content script, neither
    // event.source (security wrappers) nor the moz-extension origin can be trusted.
    // At worst, a page could close or resize the overlay: harmless.
    if (!event.data || event.data.from !== 'arbalete-palette' || !host.isConnected) return;
    if (event.data.type === 'arbalete-palette-height') frame.style.height = `${event.data.height}px`;
    if (event.data.type === 'arbalete-palette-close') close();
  }
  window.addEventListener('message', onMessage);
  backdrop.addEventListener('mousedown', close);
  // The cursor must be in the frame right away: focus it, then ask the page inside to
  // focus its first field.
  frame.addEventListener('load', () => {
    frame.focus();
    frame.contentWindow.focus();
    frame.contentWindow.postMessage({ type: 'arbalete-palette-focus' }, '*');
  });

  shadow.append(style, backdrop, frame);
  document.documentElement.append(host);
})();
