'use strict';

// Arbalète split view: two sites side by side in a single tab (two frames).
// Firefox does not let extensions create its native split view, hence this page.
// The background script removes the ban on sites being displayed in a frame
// (only for this page's frames) and reports each navigation of the frames,
// which makes it possible to show each side's address and to "separate" into two tabs.

const $ = (sel) => document.querySelector(sel);
const t = (key, ...subs) => browser.i18n.getMessage(key, subs.map(String)) || key;
const SVG_NS = 'http://www.w3.org/2000/svg';
const PERMISSIONS = { permissions: ['webRequest', 'webRequestBlocking', 'browsingData'], origins: ['<all_urls>'] };

// Sites whose service worker builds the pages itself (with the ban on being
// displayed in a frame), out of the extension's reach. This service worker is erased
// just before loading the frame: the page goes back through the network, where the ban
// is lifted. The site reinstalls it on the next visit, with no visible effect.
// The list is deliberately short: erasing a service worker also cuts the site's
// notifications (Mastodon, messaging apps...).
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
// View identifier: lets the background script reopen it after an update.
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

// Mozilla sites that no extension may modify (Firefox's
// extensions.webextensions.restrictedDomains setting): they always refuse
// to be displayed in a frame, so we directly offer to open them in a tab.
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

// Typed address: full URL, domain name, or search.
function normalizeInput(text) {
  const value = text.trim();
  if (!value) return '';
  if (/^[a-z]+:\/\//i.test(value) || value.startsWith('about:')) return value;
  if (/^[^\s]+\.[^\s]{2,}$/.test(value)) return `https://${value}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}

// The state is kept in the page's address: reload and session restore.
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

// --- The two sides -----------------------------------------------------------

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

// Empty side: pick a tab of the space, or type an address.
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

// Close a side: the tab becomes a normal tab again on the other site.
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

// "Separate": the two sites become two tabs again, in place of the split view.
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

// --- Divider: drag or keyboard arrows ----------------------------------------

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

// --- Navigation inside the frames, reported by the background script ---------

// Alt+K on a split view: the quick search overlay is shown in this page.
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
      // The background script must listen to the headers before the frames load.
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
