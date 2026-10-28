'use strict';

// Vue scindée d'Arbalète : deux sites côte à côte dans un seul onglet (deux cadres).
// Firefox ne laisse pas les extensions créer sa vue scindée native, d'où cette page.
// Le script de fond retire aux sites l'interdiction d'être affichés dans un cadre
// (uniquement pour les cadres de cette page) et signale chaque navigation des cadres,
// ce qui permet d'afficher l'adresse de chaque côté et de « séparer » en deux onglets.

const $ = (sel) => document.querySelector(sel);
const t = (key, ...subs) => browser.i18n.getMessage(key, subs.map(String)) || key;
const SVG_NS = 'http://www.w3.org/2000/svg';
const PERMISSIONS = { permissions: ['webRequest', 'webRequestBlocking', 'browsingData'], origins: ['<all_urls>'] };

// Sites dont le service worker fabrique lui-même les pages (avec l'interdiction d'être
// affichées dans un cadre), hors de portée de l'extension. On efface ce service worker
// juste avant de charger le cadre : la page repasse par le réseau, où l'interdiction
// est levée. Le site le réinstalle à la visite suivante, sans effet visible.
// Liste volontairement courte : effacer un service worker coupe aussi les
// notifications du site (Mastodon, messageries…).
const SERVICE_WORKER_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];

async function clearServiceWorker(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch (e) {
    return;
  }
  if (!SERVICE_WORKER_HOSTS.includes(hostname) || !browser.browsingData) return;
  await browser.browsingData.remove({ hostnames: SERVICE_WORKER_HOSTS }, { serviceWorkers: true }).catch(() => {});
}

const params = new URLSearchParams(location.search);
const panes = {
  left: { url: params.get('left') || '', frameId: null },
  right: { url: params.get('right') || '', frameId: null },
};
let ratio = Number(params.get('ratio')) || 0.5;
// Identifiant de la vue : permet au script de fond de la rouvrir après une mise à jour.
const sid = params.get('sid') || Math.random().toString(36).slice(2, 10);
let currentTab = null;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child != null) node.append(child);
  return node;
}

function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `../icons/lucide.svg#${name}`);
  svg.append(use);
  return svg;
}

const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url;
  } catch (e) {
    return url;
  }
};

// Sites Mozilla qu'aucune extension n'a le droit de modifier (réglage
// extensions.webextensions.restrictedDomains de Firefox) : ils refusent toujours
// l'affichage en cadre, on propose directement de les ouvrir dans un onglet.
const PROTECTED_HOSTS = [
  'accounts-static.cdn.mozilla.net', 'accounts.firefox.com', 'addons.cdn.mozilla.net', 'addons.mozilla.org',
  'api.accounts.firefox.com', 'content.cdn.mozilla.net', 'discovery.addons.mozilla.org', 'install.mozilla.org',
  'oauth.accounts.firefox.com', 'profile.accounts.firefox.com', 'support.mozilla.org', 'sync.services.mozilla.com',
];
const isProtected = (url) => {
  try {
    return PROTECTED_HOSTS.includes(new URL(url).hostname);
  } catch (e) {
    return false;
  }
};

// Adresse tapée : URL complète, nom de domaine, ou recherche.
function normalizeInput(text) {
  const value = text.trim();
  if (!value) return '';
  if (/^[a-z]+:\/\//i.test(value) || value.startsWith('about:')) return value;
  if (/^[^\s]+\.[^\s]{2,}$/.test(value)) return `https://${value}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}

// L'état est gardé dans l'adresse de la page : rechargement et restauration de session.
function saveState() {
  const q = new URLSearchParams({ sid });
  if (panes.left.url) q.set('left', panes.left.url);
  if (panes.right.url) q.set('right', panes.right.url);
  q.set('ratio', ratio.toFixed(3));
  history.replaceState(null, '', `?${q}`);
  browser.runtime.sendMessage({ type: 'splitState', sid, url: location.href }).catch(() => {});
  const names = ['left', 'right'].filter((side) => panes[side].url)
    .map((side) => panes[side].title || host(panes[side].url));
  document.title = names.join(' | ') || t('splitTitle');
}

// --- Les deux côtés ---------------------------------------------------------------------

function renderPane(side) {
  const pane = panes[side];
  const box = $(`#pane-${side}`);
  const address = el('input', {
    class: 'address',
    value: pane.url,
    placeholder: t('splitAddress'),
    'aria-label': t('splitAddress'),
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      navigate(side, normalizeInput(address.value));
      address.blur();
    },
    onfocus: () => address.select(),
  });
  const button = (name, label, onclick) => el('button', { class: 'tool', title: label, 'aria-label': label, onclick }, icon(name));
  const bar = el('header', { class: 'bar' }, [
    address,
    pane.url ? button('rotate-cw', t('splitReload'), () => navigate(side, pane.url)) : null,
    pane.url ? button('external-link', t('splitOpenTab'), () => openInTab(side)) : null,
    button('x', t('splitClosePane'), () => closePane(side)),
  ]);
  pane.address = address;

  if (!pane.url) {
    box.replaceChildren(bar, chooser(side));
    return;
  }
  if (isProtected(pane.url)) {
    box.replaceChildren(bar, el('div', { class: 'chooser' }, [
      el('h2', {}, t('splitProtectedTitle')),
      el('p', { class: 'hint' }, t('splitProtectedText', host(pane.url))),
      el('button', { class: 'primary', onclick: () => openInTab(side) }, t('splitOpenTab')),
    ]));
    return;
  }
  const frame = el('iframe', { src: pane.url, title: host(pane.url), name: 'arbalete-split' });
  frame.setAttribute('allow', 'fullscreen; clipboard-read; clipboard-write; autoplay; encrypted-media; picture-in-picture');
  pane.frame = frame;
  box.replaceChildren(bar);
  clearServiceWorker(pane.url).then(() => {
    if (pane.frame === frame) box.append(frame);
  });
  frame.addEventListener('load', () => {
    try {
      pane.frameId = browser.runtime.getFrameId(frame);
    } catch (e) {
      pane.frameId = null;
    }
  });
}

function navigate(side, url) {
  if (!url) return;
  panes[side].url = url;
  panes[side].title = '';
  saveState();
  renderPane(side);
}

// Côté vide : choisir un onglet de l'espace, ou taper une adresse.
function chooser(side) {
  const list = el('div', { class: 'choices' });
  const box = el('div', { class: 'chooser' }, [el('h2', {}, t('splitChoose')), list]);
  browser.runtime.sendMessage({ type: 'getState', windowId: currentTab.windowId }).then((state) => {
    const mine = state.tabs.find((x) => x.id === currentTab.id);
    const candidates = state.tabs.filter((x) => x.id !== currentTab.id && !x.pinned
      && x.spaceId === (mine && mine.spaceId) && /^(https?|file):/.test(x.url));
    if (!candidates.length) list.append(el('p', { class: 'hint' }, t('splitNoTabs')));
    for (const tab of candidates) {
      list.append(el('button', {
        class: 'choice',
        title: tab.url,
        onclick: async () => {
          navigate(side, tab.url);
          await browser.tabs.remove(tab.id);
        },
      }, [
        tab.favIconUrl ? el('img', { src: tab.favIconUrl, alt: '' }) : icon('globe'),
        el('span', {}, tab.title || tab.url),
      ]));
    }
  });
  return box;
}

async function openInTab(side) {
  const { url } = panes[side];
  await browser.tabs.create({
    url,
    index: currentTab.index + 1,
    openerTabId: currentTab.id,
    cookieStoreId: currentTab.cookieStoreId,
  });
  closePane(side);
}

// Fermer un côté : l'onglet redevient un onglet normal sur l'autre site.
async function closePane(side) {
  const other = panes[side === 'left' ? 'right' : 'left'].url;
  if (other) await browser.tabs.update(currentTab.id, { url: other });
  else await browser.tabs.remove(currentTab.id);
}

function swap() {
  [panes.left.url, panes.right.url] = [panes.right.url, panes.left.url];
  saveState();
  renderPane('left');
  renderPane('right');
}

// « Séparer » : les deux sites redeviennent deux onglets, à la place de la vue scindée.
async function separate() {
  let index = currentTab.index;
  for (const side of ['left', 'right']) {
    const { url } = panes[side];
    if (!url) continue;
    index += 1;
    await browser.tabs.create({
      url,
      index,
      active: side === 'left',
      openerTabId: currentTab.id,
      cookieStoreId: currentTab.cookieStoreId,
    });
  }
  await browser.tabs.remove(currentTab.id);
}

// --- Séparateur : glisser ou flèches du clavier ------------------------------------------

function applyRatio() {
  document.documentElement.style.setProperty('--ratio', ratio);
  $('#divider').setAttribute('aria-valuenow', Math.round(ratio * 100));
}

function initDivider() {
  const divider = $('#divider');
  divider.setAttribute('aria-label', t('splitDivider'));
  divider.append(el('div', { class: 'divider-tools' }, [
    el('button', { class: 'tool', title: t('splitSwap'), 'aria-label': t('splitSwap'), onclick: swap }, icon('arrow-left-right')),
    el('button', { class: 'tool', title: t('splitSeparate'), 'aria-label': t('splitSeparate'), onclick: separate }, icon('square-split-horizontal')),
  ]));
  divider.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    divider.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging');
  });
  divider.addEventListener('pointermove', (e) => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    ratio = Math.min(0.85, Math.max(0.15, e.clientX / window.innerWidth));
    applyRatio();
  });
  divider.addEventListener('pointerup', () => {
    document.body.classList.remove('dragging');
    saveState();
  });
  divider.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowLeft' ? -0.05 : e.key === 'ArrowRight' ? 0.05 : 0;
    if (!step) return;
    ratio = Math.min(0.85, Math.max(0.15, ratio + step));
    applyRatio();
    saveState();
    e.preventDefault();
  });
  applyRatio();
}

// --- Navigation dans les cadres, signalée par le script de fond ---------------------------

// Alt+K sur une vue scindée : le calque de recherche rapide s'affiche dans cette page.
browser.runtime.onMessage.addListener((message) => {
  if (message.type !== 'togglePalette' || !currentTab || message.tabId !== currentTab.id) return;
  const script = document.createElement('script');
  script.src = '../palette/overlay.js';
  script.addEventListener('load', () => script.remove());
  document.head.append(script);
});

browser.runtime.onMessage.addListener((message) => {
  if (message.type !== 'splitFrame' || !currentTab || message.tabId !== currentTab.id) return;
  const { url, title } = message;
  for (const side of ['left', 'right']) {
    const pane = panes[side];
    if (pane.frameId !== message.frameId) continue;
    if (pane.url === url && (!title || pane.title === title)) continue;
    pane.url = url;
    if (title) pane.title = title;
    if (pane.address && document.activeElement !== pane.address) pane.address.value = url;
    if (pane.frame) pane.frame.title = title || host(url);
    saveState();
  }
});

async function start() {
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  document.documentElement.lang = browser.i18n.getUILanguage();
  currentTab = await browser.tabs.getCurrent();

  if (!(await browser.permissions.contains(PERMISSIONS))) {
    $('#permission').hidden = false;
    $('#grant').addEventListener('click', async () => {
      if (!(await browser.permissions.request(PERMISSIONS))) return;
      // Le script de fond doit écouter les en-têtes avant que les cadres se chargent.
      await browser.runtime.sendMessage({ type: 'enableSplit' });
      location.reload();
    });
    return;
  }
  $('#split').hidden = false;
  initDivider();
  saveState();
  renderPane('left');
  renderPane('right');
}

start();
