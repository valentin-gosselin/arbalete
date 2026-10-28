'use strict';

// Injected in the pages displayed by the Arbalète split view, and only there:
// split.js names its frames "arbalete-split", other pages are ignored.
if (window.name === 'arbalete-split' && window.parent !== window) {
  // 1. YouTube's embedded player needs to know the site embedding it
  //    (document.referrer, otherwise "Error 153"); an extension page provides none.
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname) && location.pathname.startsWith('/embed/') && !document.referrer) {
    Object.defineProperty(document.wrappedJSObject, 'referrer', {
      get: exportFunction(() => 'https://github.com/valentin-gosselin/arbalete', window),
      configurable: true,
    });
  }

  // 2. Web apps (YouTube, Mastodon...) change page without reloading: each change of
  //    address or title is reported to the split view.
  let lastUrl = '';
  let lastTitle = '';
  const report = () => {
    if (location.href === lastUrl && document.title === lastTitle) return;
    lastUrl = location.href;
    lastTitle = document.title;
    browser.runtime.sendMessage({ type: 'splitFrameChanged', url: lastUrl, title: lastTitle }).catch(() => {});
  };
  window.addEventListener('popstate', report);
  window.addEventListener('hashchange', report);
  window.addEventListener('load', report);
  setInterval(report, 700);
}
