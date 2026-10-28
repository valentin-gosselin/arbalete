'use strict';

// Injecté dans les pages affichées par la vue scindée d'Arbalète, et seulement là :
// split.js nomme ses cadres « arbalete-split », les autres pages sont ignorées.
if (window.name === 'arbalete-split' && window.parent !== window) {
  // 1. Le lecteur intégré de YouTube exige de connaître le site qui l'intègre
  //    (document.referrer, sinon « Erreur 153 ») ; une page d'extension n'en fournit pas.
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname) && location.pathname.startsWith('/embed/') && !document.referrer) {
    Object.defineProperty(document.wrappedJSObject, 'referrer', {
      get: exportFunction(() => 'https://github.com/valentin-gosselin/arbalete', window),
      configurable: true,
    });
  }

  // 2. Les applis web (YouTube, Mastodon…) changent de page sans recharger : on signale
  //    chaque changement d'adresse ou de titre à la vue scindée.
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
