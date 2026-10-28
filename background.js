'use strict';

// Arbalète : chaque onglet appartient à un espace. Changer d'espace masque les
// onglets des autres espaces (tabs.hide) au lieu d'ouvrir une autre fenêtre.
// L'appartenance est mémorisée par Firefox (sessions.setTabValue), donc elle
// survit aux redémarrages et à la réouverture d'un onglet fermé.

const t = (key, ...subs) => browser.i18n.getMessage(key, subs.map(String)) || key;

const PALETTE = ['#7c6cf2', '#e4834b', '#3fa37b', '#d9577a', '#3d8bd9', '#c9a227'];
const DEFAULT_SPACES = [
  { id: 'perso', name: t('spacePersonal'), icon: 'lucide:house', color: PALETTE[0], cookieStoreId: null, favorites: [] },
  { id: 'boulot', name: t('spaceWork'), icon: 'lucide:briefcase', color: PALETTE[1], cookieStoreId: null, favorites: [] },
];
const SIDEBAR_PAGE = browser.runtime.getURL('sidebar/sidebar.html');
const SPLIT_PAGE = browser.runtime.getURL('split/split.html');
const PALETTE_PAGE = browser.runtime.getURL('palette/palette.html');
const BLANK_URLS = ['about:newtab', 'about:home'];

let spaces = [];
let shared = []; // favoris communs à tous les espaces
const activeByWindow = new Map(); // windowId -> spaceId
const tabSpace = new Map(); // tabId -> spaceId
const tabFav = new Map(); // tabId -> favId (onglet ouvert depuis un favori)

const uid = () => Math.random().toString(36).slice(2, 10);
const getSpace = (id) => spaces.find((s) => s.id === id);

function activeSpace(windowId) {
  if (!activeByWindow.has(windowId)) activeByWindow.set(windowId, spaces[0].id);
  return activeByWindow.get(windowId);
}

function assign(tabId, spaceId) {
  tabSpace.set(tabId, spaceId);
  browser.sessions.setTabValue(tabId, 'space', spaceId).catch(() => {});
}

function setFav(tabId, favId) {
  if (favId) tabFav.set(tabId, favId);
  else tabFav.delete(tabId);
  const op = favId
    ? browser.sessions.setTabValue(tabId, 'fav', favId)
    : browser.sessions.removeTabValue(tabId, 'fav');
  op.catch(() => {});
}

// Les espaces passent par Firefox Sync pour suivre d'un PC à l'autre (boulot / maison).
// Une clé par espace, car storage.sync limite chaque valeur à 8 Ko.
function toStored(space) {
  const favorites = space.favorites.map((f) => ({
    ...f,
    favIconUrl: f.favIconUrl && f.favIconUrl.length < 1500 ? f.favIconUrl : '',
  }));
  return { ...space, favorites };
}

async function saveSpaces() {
  const payload = { order: spaces.map((s) => s.id), shared: shared.map((f) => toStored({ favorites: [f] }).favorites[0]) };
  for (const s of spaces) payload['space:' + s.id] = toStored(s);
  saving = true;
  try {
    await browser.storage.sync.set(payload);
    const all = await browser.storage.sync.get(null);
    const stale = Object.keys(all).filter((k) => k.startsWith('space:') && !payload[k]);
    if (stale.length) await browser.storage.sync.remove(stale);
  } finally {
    saving = false;
  }
  buildMenus();
  applyThemeEverywhere().catch(() => {});
  notify();
}

// Les identifiants de conteneur changent d'un profil Firefox à l'autre : on les
// retrouve par leur nom, et on crée le conteneur s'il n'existe pas encore ici.
async function resolveContainers() {
  let containers;
  try {
    containers = await browser.contextualIdentities.query({});
  } catch (e) {
    return;
  }
  for (const s of spaces) {
    if (!s.containerName) continue;
    let c = containers.find((x) => x.cookieStoreId === s.cookieStoreId && x.name === s.containerName)
      || containers.find((x) => x.name === s.containerName);
    if (!c) {
      c = await browser.contextualIdentities.create({ name: s.containerName, color: 'purple', icon: 'circle' });
      containers.push(c);
    }
    s.cookieStoreId = c.cookieStoreId;
  }
}

async function loadSpaces() {
  const data = await browser.storage.sync.get(null);
  let loaded = Array.isArray(data.order) ? data.order.map((id) => data['space:' + id]).filter(Boolean) : [];
  if (!loaded.length) loaded = DEFAULT_SPACES.map((s) => ({ ...s, favorites: [] }));
  spaces = loaded;
  shared = Array.isArray(data.shared) ? data.shared : [];
  await resolveContainers();
  if (!data.order) await saveSpaces();
  else buildMenus();
}

let saving = false;

let notifyTimer = null;
function notify() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    browser.runtime.sendMessage({ type: 'refresh' }).catch(() => {});
  }, 30);
}

// --- Affichage d'un espace ---------------------------------------------------

async function applyVisibility(windowId) {
  const spaceId = activeSpace(windowId);
  const tabs = await browser.tabs.query({ windowId });
  const show = [];
  const hide = [];
  for (const t of tabs) {
    if (t.pinned) continue; // Firefox refuse de masquer les onglets épinglés
    (tabSpace.get(t.id) === spaceId ? show : hide).push(t.id);
  }
  if (show.length) await browser.tabs.show(show);
  if (hide.length) await browser.tabs.hide(hide).catch(() => {});
}

// L'onglet actif doit appartenir à l'espace affiché, sinon Firefox ne peut pas le masquer.
async function ensureActiveInSpace(windowId) {
  const spaceId = activeSpace(windowId);
  const tabs = await browser.tabs.query({ windowId });
  const active = tabs.find((t) => t.active);
  if (active && (active.pinned || tabSpace.get(active.id) === spaceId)) return;
  const candidates = tabs
    .filter((t) => !t.pinned && tabSpace.get(t.id) === spaceId)
    .sort((a, b) => b.lastAccessed - a.lastAccessed);
  if (candidates.length) await browser.tabs.update(candidates[0].id, { active: true });
  else await newTab(windowId, spaceId);
}

async function switchSpace(windowId, spaceId) {
  if (!getSpace(spaceId)) return;
  activeByWindow.set(windowId, spaceId);
  browser.sessions.setWindowValue(windowId, 'space', spaceId).catch(() => {});
  await ensureActiveInSpace(windowId);
  await applyVisibility(windowId);
  applyTheme(windowId).catch(() => {});
  notify();
}

async function switchRelative(windowId, delta) {
  const i = spaces.findIndex((s) => s.id === activeSpace(windowId));
  const next = spaces[(i + delta + spaces.length) % spaces.length];
  await switchSpace(windowId, next.id);
}

async function newTab(windowId, spaceId, url) {
  const space = getSpace(spaceId);
  const props = { windowId, active: true };
  if (url) props.url = url;
  if (space && space.cookieStoreId) props.cookieStoreId = space.cookieStoreId;
  const tab = await browser.tabs.create(props);
  assign(tab.id, spaceId);
  return tab;
}

async function moveTab(tabId, spaceId) {
  const tab = await browser.tabs.get(tabId);
  assign(tabId, spaceId);
  setFav(tabId, null);
  await ensureActiveInSpace(tab.windowId);
  await applyVisibility(tab.windowId);
  notify();
}

// --- Favoris (onglets « épinglés » propres à chaque espace) -------------------

// Favoris : ceux de l'espace, plus les favoris communs à tous les espaces (shared).
// Un favori commun s'ouvre dans l'espace où on clique : un onglet par espace.
function findFavorite(spaceId, favId) {
  const space = getSpace(spaceId);
  const own = space && space.favorites.find((f) => f.id === favId);
  if (own) return { fav: own, shared: false };
  const common = shared.find((f) => f.id === favId);
  return common ? { fav: common, shared: true } : null;
}

async function openFavorite(windowId, spaceId, favId) {
  const found = findFavorite(spaceId, favId);
  if (!found) return;
  const tabs = await browser.tabs.query({ windowId });
  const existing = tabs.find((t) => tabFav.get(t.id) === favId && tabSpace.get(t.id) === spaceId);
  if (existing) {
    await browser.tabs.update(existing.id, { active: true });
    return;
  }
  const tab = await newTab(windowId, spaceId, found.fav.url);
  setFav(tab.id, favId);
  notify();
}

async function addFavorite(tabId) {
  const tab = await browser.tabs.get(tabId);
  const space = getSpace(tabSpace.get(tabId));
  if (!space || !/^https?:|^file:/.test(tab.url)) return;
  const fav = { id: uid(), url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl || '' };
  space.favorites.push(fav);
  setFav(tabId, fav.id);
  await saveSpaces();
}

// Lien glissé depuis une page web vers les tuiles.
async function addFavoriteUrl(windowId, url, title) {
  if (!/^https?:|^file:/.test(url || '')) return;
  const space = getSpace(activeSpace(windowId));
  let name = title;
  try {
    name = name || new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    name = url;
  }
  space.favorites.push({ id: uid(), url, title: name, favIconUrl: '' });
  await saveSpaces();
}

async function removeFavorite(spaceId, favId) {
  const space = getSpace(spaceId);
  if (space) space.favorites = space.favorites.filter((f) => f.id !== favId);
  shared = shared.filter((f) => f.id !== favId);
  for (const [tabId, id] of tabFav) if (id === favId) setFav(tabId, null);
  await saveSpaces();
}

// « Mettre à jour le favori avec cette page » : le favori pointe désormais sur la page
// actuelle de son onglet.
async function updateFavorite(spaceId, favId, tabId) {
  const found = findFavorite(spaceId, favId);
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!found || !tab || !/^https?:|^file:/.test(tab.url)) return;
  Object.assign(found.fav, { url: tab.url, title: tab.title || found.fav.title, favIconUrl: tab.favIconUrl || found.fav.favIconUrl });
  await saveSpaces();
}

// Favori commun <-> favori de l'espace.
async function toggleSharedFavorite(spaceId, favId) {
  const space = getSpace(spaceId);
  const found = findFavorite(spaceId, favId);
  if (!space || !found) return;
  if (found.shared) {
    shared = shared.filter((f) => f !== found.fav);
    space.favorites.push(found.fav);
  } else {
    space.favorites = space.favorites.filter((f) => f !== found.fav);
    shared.push(found.fav);
  }
  await saveSpaces();
}

// Si l'onglet d'un favori a changé de page, on le remet sur l'adresse du favori.
async function resetFavorite(tabId) {
  const found = findFavorite(tabSpace.get(tabId), tabFav.get(tabId));
  if (found) await browser.tabs.update(tabId, { url: found.fav.url });
}

// --- Gestion des espaces --------------------------------------------------------

async function upsertSpace(data) {
  const existing = getSpace(data.id);
  if (existing) Object.assign(existing, data);
  else spaces.push({ favorites: [], cookieStoreId: null, ...data });
  await saveSpaces();
}

async function createSpace(windowId) {
  const space = {
    id: uid(),
    name: t('newSpaceName'),
    icon: 'lucide:sparkles',
    color: PALETTE[spaces.length % PALETTE.length],
    cookieStoreId: null,
    favorites: [],
  };
  spaces.push(space);
  await saveSpaces();
  await switchSpace(windowId, space.id);
  return space.id;
}

async function deleteSpace(spaceId) {
  if (spaces.length < 2) return;
  const fallback = spaces.find((s) => s.id !== spaceId);
  spaces = spaces.filter((s) => s.id !== spaceId);
  for (const [tabId, id] of tabSpace) {
    if (id === spaceId) {
      assign(tabId, fallback.id);
      setFav(tabId, null);
    }
  }
  for (const [windowId, id] of activeByWindow) {
    if (id === spaceId) await switchSpace(windowId, fallback.id);
  }
  await saveSpaces();
}

async function reorderSpaces(ids) {
  spaces.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  await saveSpaces();
}

async function copyUrl() {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return;
  await navigator.clipboard.writeText(tab.url);
  browser.runtime.sendMessage({ type: 'toast', text: t('urlCopied') }).catch(() => {});
}

async function getState(windowId) {
  const tabs = await browser.tabs.query({ windowId });
  let containers = [];
  try {
    containers = await browser.contextualIdentities.query({});
  } catch (e) {
    // Conteneurs désactivés dans Firefox : on laisse la liste vide.
  }
  let groups = [];
  if (browser.tabGroups) {
    groups = (await browser.tabGroups.query({ windowId }).catch(() => [])).map((g) => ({
      id: g.id,
      title: g.title,
      color: g.color,
      collapsed: g.collapsed,
    }));
  }
  return {
    spaces,
    shared,
    groups,
    activeSpaceId: activeSpace(windowId),
    containers: containers.map((c) => ({ id: c.cookieStoreId, name: c.name, color: c.colorCode })),
    tabs: tabs.map((t) => ({
      id: t.id,
      index: t.index,
      lastAccessed: t.lastAccessed,
      title: t.title,
      url: t.url,
      favIconUrl: t.favIconUrl || '',
      active: t.active,
      pinned: t.pinned,
      audible: t.audible,
      muted: !!(t.mutedInfo && t.mutedInfo.muted),
      highlighted: t.highlighted,
      discarded: t.discarded,
      splitViewId: t.splitViewId === undefined ? -1 : t.splitViewId,
      status: t.status,
      cookieStoreId: t.cookieStoreId,
      groupId: t.groupId === undefined ? -1 : t.groupId,
      spaceId: tabSpace.get(t.id) || null,
      favId: tabFav.get(t.id) || null,
    })),
  };
}

// --- Démarrage --------------------------------------------------------------

async function init() {
  await loadSpaces();

  for (const win of await browser.windows.getAll({ windowTypes: ['normal'] })) {
    const saved = await browser.sessions.getWindowValue(win.id, 'space').catch(() => null);
    activeByWindow.set(win.id, getSpace(saved) ? saved : spaces[0].id);
  }
  for (const tab of await browser.tabs.query({})) {
    if (tab.pinned) continue;
    const saved = await browser.sessions.getTabValue(tab.id, 'space').catch(() => null);
    assign(tab.id, getSpace(saved) ? saved : activeSpace(tab.windowId));
    const fav = await browser.sessions.getTabValue(tab.id, 'fav').catch(() => null);
    if (fav) tabFav.set(tab.id, fav);
  }
  for (const windowId of activeByWindow.keys()) {
    await ensureActiveInSpace(windowId);
    await applyVisibility(windowId);
  }
}

const ready = init();

// Rouvrir les vues scindées après un rechargement ou une mise à jour de l'extension.
// Au démarrage de Firefox (onStartup), la restauration de session s'en charge déjà.
let browserStarting = false;
browser.runtime.onStartup.addListener(() => { browserStarting = true; });
ready.then(() => setTimeout(() => {
  if (!browserStarting) restoreSplits().catch(() => {});
}, 1500));

// Largeur de la barre : userChrome.css repère un caractère invisible à la fin du
// titre de la barre. ‌ = dépliée en permanence, ​ = élargie au survol.
async function applyHoverOption() {
  const { expandOnHover, pinnedOpen } = await browser.storage.local.get(['expandOnHover', 'pinnedOpen']);
  const marker = pinnedOpen ? '‌' : expandOnHover ? '​' : '';
  await browser.sidebarAction.setTitle({ title: `Arbalète${marker}` });
}
applyHoverOption();
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.expandOnHover || changes.pinnedOpen)) applyHoverOption();
});

// --- Événements Firefox -----------------------------------------------------

browser.windows.onCreated.addListener(async (win) => {
  await ready;
  const saved = await browser.sessions.getWindowValue(win.id, 'space').catch(() => null);
  if (getSpace(saved)) activeByWindow.set(win.id, saved);
  else {
    const last = [...activeByWindow.values()].pop();
    activeByWindow.set(win.id, last || spaces[0].id);
  }
});

browser.windows.onRemoved.addListener((windowId) => activeByWindow.delete(windowId));

browser.tabs.onCreated.addListener(async (tab) => {
  await ready;
  if (tab.pinned || tabSpace.has(tab.id)) return notify();
  // Petites fenêtres (édition d'un espace, popups de connexion) : hors espaces.
  const win = await browser.windows.get(tab.windowId).catch(() => null);
  if (!win || win.type !== 'normal') return;

  // Onglet rouvert (Ctrl+Maj+T, restauration de session) : il garde son espace.
  const saved = await browser.sessions.getTabValue(tab.id, 'space').catch(() => null);
  if (tabSpace.has(tab.id)) return notify(); // assigné entre-temps par newTab()
  let spaceId = getSpace(saved) ? saved : activeSpace(tab.windowId);
  if (!saved && tab.openerTabId && tabSpace.has(tab.openerTabId)) spaceId = tabSpace.get(tab.openerTabId);
  assign(tab.id, spaceId);

  // Ctrl+T dans un espace lié à un conteneur : on rouvre l'onglet dans ce conteneur.
  const space = getSpace(spaceId);
  if (!saved && space.cookieStoreId && tab.cookieStoreId !== space.cookieStoreId && BLANK_URLS.includes(tab.url)) {
    try {
      const replacement = await browser.tabs.create({
        windowId: tab.windowId,
        index: tab.index,
        active: tab.active,
        cookieStoreId: space.cookieStoreId,
      });
      assign(replacement.id, spaceId);
      await browser.tabs.remove(tab.id);
    } catch (e) {
      // Conteneur supprimé entre-temps : on garde l'onglet tel quel.
    }
    return notify();
  }

  if (spaceId !== activeSpace(tab.windowId)) {
    if (tab.active) await switchSpace(tab.windowId, spaceId);
    else await browser.tabs.hide(tab.id).catch(() => {});
  }
  notify();
});

browser.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  await ready;
  const spaceId = tabSpace.get(tabId);
  // Onglet d'un autre espace activé depuis ailleurs (recherche d'onglets, lien…) : on suit.
  if (spaceId && spaceId !== activeSpace(windowId)) await switchSpace(windowId, spaceId);
  else notify();
});

browser.tabs.onRemoved.addListener(onSplitTabRemoved);
browser.tabs.onRemoved.addListener((tabId) => {
  tabSpace.delete(tabId);
  tabFav.delete(tabId);
  notify();
});

function onTabUpdated(tabId, change) {
  // Vue scindée redevenue un onglet normal (côté fermé) : on l'oublie.
  if (change.url && splitTabs.has(tabId) && !change.url.startsWith(SPLIT_PAGE)) {
    forgetSplit(splitTabs.get(tabId));
    splitTabs.delete(tabId);
  }
  if (change.pinned === false && !tabSpace.has(tabId)) {
    browser.tabs.get(tabId).then((t) => assign(tabId, activeSpace(t.windowId)));
  }
  notify();
}
const WATCHED = ['title', 'favIconUrl', 'status', 'pinned', 'audible', 'mutedInfo', 'url', 'discarded'];
try {
  // splitViewId n'existe que dans les Firefox récents (vue scindée).
  browser.tabs.onUpdated.addListener(onTabUpdated, { properties: [...WATCHED, 'splitViewId'] });
} catch (e) {
  browser.tabs.onUpdated.addListener(onTabUpdated, { properties: WATCHED });
}

browser.tabs.onMoved.addListener(notify);
browser.tabs.onHighlighted.addListener(notify);

browser.tabs.onAttached.addListener(async (tabId, { newWindowId }) => {
  await ready;
  await applyVisibility(newWindowId);
  notify();
});

browser.contextualIdentities.onRemoved.addListener(async ({ contextualIdentity }) => {
  await ready;
  for (const s of spaces) {
    if (s.cookieStoreId === contextualIdentity.cookieStoreId) {
      s.cookieStoreId = null;
      s.containerName = null;
    }
  }
  await saveSpaces();
});

// Modification arrivée de l'autre PC via Firefox Sync.
browser.storage.onChanged.addListener(async (changes, area) => {
  await ready;
  if (area !== 'sync' || saving) return;
  await loadSpaces();
  for (const [windowId, spaceId] of activeByWindow) {
    if (!getSpace(spaceId)) await switchSpace(windowId, spaces[0].id);
  }
  notify();
});

// Import d'un fichier exporté (par exemple déposé dans Nextcloud) : remplace les espaces.
async function importSpaces(imported) {
  if (!Array.isArray(imported) || !imported.length) throw new Error('Fichier invalide');
  spaces = imported.map((s) => ({
    id: String(s.id || uid()),
    name: String(s.name || t('spaceFallbackName')),
    icon: String(s.icon || 'lucide:sparkles'),
    color: String(s.color || PALETTE[0]),
    containerName: s.containerName || null,
    cookieStoreId: null,
    archiveAfter: Number(s.archiveAfter) || 0,
    sites: Array.isArray(s.sites) ? s.sites.map(String) : [],
    schedule: s.schedule && typeof s.schedule === 'object' ? s.schedule : null,
    color2: s.color2 || null,
    favorites: (s.favorites || []).map((f) => ({ id: f.id || uid(), url: f.url, title: f.title || f.url, favIconUrl: f.favIconUrl || '' })),
  }));
  await resolveContainers();
  // Les onglets des espaces disparus rejoignent le premier espace.
  for (const [tabId, id] of tabSpace) if (!getSpace(id)) assign(tabId, spaces[0].id);
  for (const [windowId, id] of activeByWindow) await switchSpace(windowId, getSpace(id) ? id : spaces[0].id);
  await saveSpaces();
}

browser.commands.onCommand.addListener(async (command) => {
  await ready;
  const win = await browser.windows.getLastFocused();
  if (command === 'copy-url') return copyUrl();
  if (command === 'space-next') return switchRelative(win.id, 1);
  if (command === 'space-prev') return switchRelative(win.id, -1);
  const m = /^space-(\d)$/.exec(command);
  if (m && spaces[m[1] - 1]) return switchSpace(win.id, spaces[m[1] - 1].id);

  // Onglet actif vers l'espace suivant / précédent (on le suit).
  if (command === 'move-tab-next' || command === 'move-tab-prev') {
    const [tab] = await browser.tabs.query({ windowId: win.id, active: true });
    if (!tab || tab.pinned) return undefined;
    const i = spaces.findIndex((s) => s.id === activeSpace(win.id));
    const target = spaces[(i + (command === 'move-tab-next' ? 1 : -1) + spaces.length) % spaces.length];
    assign(tab.id, target.id);
    setFav(tab.id, null);
    return switchSpace(win.id, target.id);
  }

  // Favori n de l'espace actif.
  const f = /^favorite-(\d)$/.exec(command);
  if (f) {
    const space = getSpace(activeSpace(win.id));
    const fav = space && space.favorites[f[1] - 1];
    if (fav) return openFavorite(win.id, space.id, fav.id);
  }
  return undefined;
});

if (browser.tabGroups) {
  for (const event of ['onCreated', 'onUpdated', 'onRemoved', 'onMoved']) {
    if (browser.tabGroups[event]) browser.tabGroups[event].addListener(notify);
  }
}

// --- Petites fenêtres (édition d'un espace, réglages) ----------------------------
// La barre compacte est trop étroite pour un formulaire : on ouvre la même page
// dans une petite fenêtre, en mode « edit » ou « settings ».

function openPopup(query, height) {
  return browser.windows.create({
    url: `${SIDEBAR_PAGE}?${query}`,
    type: 'popup',
    width: 400,
    height,
  });
}

const editSpace = (windowId, spaceId) => openPopup(`edit=${encodeURIComponent(spaceId)}&win=${windowId}`, 780);
const openSettings = (windowId) => openPopup(`settings=1&win=${windowId}`, 640);
const openSetup = (windowId) => openPopup(`setup=1&win=${windowId}`, 560);

// Première installation : on propose tout de suite de masquer les onglets natifs.
browser.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  await ready;
  const win = await browser.windows.getLastFocused();
  openSetup(win.id);
});

// --- Règles par site --------------------------------------------------------------------
// Chaque espace peut lister des sites (space.sites, un domaine par ligne) : un onglet
// qui charge l'un d'eux rejoint l'espace (et son conteneur s'il en a un). Si c'est
// l'onglet affiché, on suit. Le premier espace qui revendique le site l'emporte.

function siteRuleSpace(url) {
  let hostname;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    hostname = u.hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
  return spaces.find((s) => (s.sites || []).some((d) => hostname === d || hostname.endsWith(`.${d}`))) || null;
}

const ruleMoves = new Set(); // onglets en cours de réouverture dans un conteneur

async function applySiteRule(tab) {
  if (tab.pinned || ruleMoves.has(tab.id)) return;
  const win = await browser.windows.get(tab.windowId).catch(() => null);
  if (!win || win.type !== 'normal') return;
  const space = siteRuleSpace(tab.url);
  if (!space) return;
  const needsContainer = space.cookieStoreId && tab.cookieStoreId !== space.cookieStoreId;
  if (tabSpace.get(tab.id) === space.id && !needsContainer) return;

  if (needsContainer) {
    // Les cookies d'un conteneur ne se changent pas à chaud : on rouvre dans le bon.
    ruleMoves.add(tab.id);
    try {
      const reopened = await browser.tabs.create({
        windowId: tab.windowId,
        index: tab.index + 1,
        url: tab.url,
        active: tab.active,
        cookieStoreId: space.cookieStoreId,
      });
      assign(reopened.id, space.id);
      await browser.tabs.remove(tab.id);
      if (reopened.active) await switchSpace(tab.windowId, space.id);
      else await applyVisibility(tab.windowId);
    } finally {
      ruleMoves.delete(tab.id);
    }
    return;
  }
  assign(tab.id, space.id);
  setFav(tab.id, null);
  if (tab.active) await switchSpace(tab.windowId, space.id);
  else await applyVisibility(tab.windowId);
  notify();
}

browser.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url) ready.then(() => applySiteRule(tab)).catch(() => {});
}, { properties: ['url'] });

// --- Bascule horaire ---------------------------------------------------------------------
// space.schedule = { days: 'all' | 'week' | 'weekend', from: 'HH:MM', to: 'HH:MM' }.
// À l'entrée dans la plage d'un espace, toutes les fenêtres y passent, une seule fois :
// on peut ensuite changer d'espace à la main sans être ramené.

function scheduledSpace(date) {
  const day = date.getDay(); // 0 = dimanche
  const minutes = date.getHours() * 60 + date.getMinutes();
  const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm || '').split(':').map(Number);
    return Number.isFinite(h) ? h * 60 + (m || 0) : null;
  };
  return spaces.find((s) => {
    const rule = s.schedule;
    if (!rule) return false;
    const weekend = day === 0 || day === 6;
    if ((rule.days === 'week' && weekend) || (rule.days === 'weekend' && !weekend)) return false;
    const from = toMinutes(rule.from);
    const to = toMinutes(rule.to);
    if (from === null || to === null) return false;
    return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to; // plage de nuit
  }) || null;
}

let lastScheduledId;
async function checkSchedule() {
  const space = scheduledSpace(new Date());
  const id = space ? space.id : null;
  if (lastScheduledId === undefined) {
    lastScheduledId = id; // au démarrage, on ne bouscule pas l'espace restauré
    return;
  }
  if (id === lastScheduledId) return;
  lastScheduledId = id;
  if (!space) return;
  for (const windowId of activeByWindow.keys()) {
    if (activeSpace(windowId) !== space.id) await switchSpace(windowId, space.id);
  }
}

// --- Thème aux couleurs de l'espace (option des réglages) --------------------------------

function mix(hex, other, weight) {
  const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = parse(hex);
  const b = parse(other);
  return `#${a.map((v, i) => Math.round(v * weight + b[i] * (1 - weight)).toString(16).padStart(2, '0')).join('')}`;
}

async function applyTheme(windowId) {
  if (!browser.theme) return;
  const { tintTheme } = await browser.storage.local.get('tintTheme');
  if (!tintTheme) return;
  const space = getSpace(activeSpace(windowId));
  if (!space || !/^#[0-9a-f]{6}$/i.test(space.color)) return;
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const base = dark ? '#1c1b22' : '#f0f0f4';
  const text = dark ? '#fbfbfe' : '#15141a';
  await browser.theme.update(windowId, {
    colors: {
      frame: mix(space.color, base, dark ? 0.35 : 0.25),
      frame_inactive: mix(space.color, base, dark ? 0.2 : 0.15),
      tab_background_text: text,
      toolbar: mix(space.color, base, dark ? 0.18 : 0.12),
      toolbar_text: text,
      toolbar_field: mix(space.color, dark ? '#2b2a33' : '#ffffff', 0.08),
      toolbar_field_text: text,
      sidebar: mix(space.color, base, dark ? 0.1 : 0.06),
      sidebar_text: text,
    },
  }).catch(() => {});
}

async function applyThemeEverywhere() {
  const { tintTheme } = await browser.storage.local.get('tintTheme');
  for (const windowId of activeByWindow.keys()) {
    if (tintTheme) await applyTheme(windowId);
    else if (browser.theme) await browser.theme.reset(windowId).catch(() => {});
  }
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.tintTheme) applyThemeEverywhere();
});

// --- Statistiques : temps passé par espace ------------------------------------------------
// Chaque minute où une fenêtre de Firefox a le focus, on compte une minute pour son
// espace actif. Gardé 14 jours, sur ce PC seulement.

async function countMinute() {
  const win = await browser.windows.getLastFocused().catch(() => null);
  if (!win || !win.focused || win.type !== 'normal') return;
  const spaceId = activeSpace(win.id);
  const day = new Date().toISOString().slice(0, 10);
  const { stats = {} } = await browser.storage.local.get('stats');
  stats[day] = stats[day] || {};
  stats[day][spaceId] = (stats[day][spaceId] || 0) + 1;
  for (const d of Object.keys(stats).sort().slice(0, -14)) delete stats[d];
  await browser.storage.local.set({ stats });
}

// Une horloge à la minute pour les horaires et les statistiques.
ready.then(() => {
  checkSchedule().catch(() => {});
  applyThemeEverywhere().catch(() => {});
  setInterval(() => {
    checkSchedule().catch(() => {});
    countMinute().catch(() => {});
  }, 60e3);
});

// --- Archive et nettoyage automatique (façon Arc) ------------------------------------------
// Chaque espace peut ranger tout seul ses onglets inactifs depuis un délai (archiveAfter,
// en heures, 0 = jamais). Ils vont dans l'archive de l'espace (storage.local, propre à
// ce PC), d'où on les rouvre en un clic. L'archive est purgée après 30 jours.
// Jamais archivés : onglet actif, épinglés, favoris, onglets qui jouent du son, onglets
// sélectionnés ou dans un groupe, pages internes.

const ARCHIVE_DAYS = 30;
const ARCHIVE_MAX_PER_SPACE = 300;
const ARCHIVE_DELAYS = [0, 12, 24, 168]; // heures proposées dans « Modifier l'espace »

async function readArchive() {
  const { archive = {} } = await browser.storage.local.get('archive');
  return archive;
}

async function writeArchive(archive) {
  const limit = Date.now() - ARCHIVE_DAYS * 86400e3;
  for (const id of Object.keys(archive)) {
    archive[id] = archive[id].filter((x) => x.archivedAt > limit).slice(0, ARCHIVE_MAX_PER_SPACE);
    if (!archive[id].length || !getSpace(id)) delete archive[id];
  }
  await browser.storage.local.set({ archive });
  notify();
}

const archivable = (tab) => !tab.pinned && /^(https?|file):/.test(tab.url) && !tabFav.has(tab.id);

// Range des onglets dans l'archive de leur espace, puis les ferme.
async function archiveTabs(tabs) {
  if (!tabs.length) return;
  const archive = await readArchive();
  const now = Date.now();
  for (const tab of tabs) {
    const spaceId = tabSpace.get(tab.id);
    if (!spaceId) continue;
    const list = (archive[spaceId] || []).filter((x) => x.url !== tab.url);
    list.unshift({ url: tab.url, title: tab.title || tab.url, favIconUrl: tab.favIconUrl || '', archivedAt: now });
    archive[spaceId] = list;
  }
  await writeArchive(archive);
  await browser.tabs.remove(tabs.map((tab) => tab.id));
}

async function autoArchive() {
  const now = Date.now();
  const tabs = await browser.tabs.query({});
  const old = [];
  for (const space of spaces) {
    if (!space.archiveAfter) continue;
    const limit = now - space.archiveAfter * 3600e3;
    old.push(...tabs.filter((tab) => tabSpace.get(tab.id) === space.id && archivable(tab)
      && !tab.active && !tab.audible && !tab.highlighted
      && (tab.groupId === undefined || tab.groupId === -1)
      && tab.lastAccessed && tab.lastAccessed < limit));
  }
  await archiveTabs(old);
  if (!old.length) await writeArchive(await readArchive()); // purge des vieilles entrées
}

// Toutes les 10 minutes, et une minute après le démarrage.
ready.then(() => setTimeout(() => autoArchive().catch(() => {}), 60e3));
setInterval(() => ready.then(autoArchive).catch(() => {}), 10 * 60e3);

async function reopenArchived(windowId, spaceId, url) {
  const archive = await readArchive();
  archive[spaceId] = (archive[spaceId] || []).filter((x) => x.url !== url);
  await writeArchive(archive);
  if (getSpace(spaceId) && activeSpace(windowId) !== spaceId) await switchSpace(windowId, spaceId);
  await newTab(windowId, getSpace(spaceId) ? spaceId : activeSpace(windowId), url);
}

async function removeArchived(spaceId, url) {
  const archive = await readArchive();
  archive[spaceId] = (archive[spaceId] || []).filter((x) => url && x.url !== url);
  await writeArchive(archive);
}

const openArchive = (windowId) => openPopup(`archive=1&win=${windowId}`, 560);

// --- Menus contextuels -------------------------------------------------------------
// Clic droit dans la barre : on affiche un vrai menu Firefox (menus.overrideContext),
// qui peut déborder de la barre. Mais sur un onglet, Firefox n'y met QUE les entrées
// des extensions, pas les siennes : Arbalète recrée donc le menu d'onglet de Firefox
// (tout ce qu'une API permet ; pas la vue scindée ni l'envoi vers un appareil).
// Ces entrées « natives » ne s'affichent que depuis la barre (viewType sidebar),
// pour ne pas doubler le vrai menu quand les onglets natifs sont visibles.

let lastMenuTarget = null; // { kind: 'fav' | 'space' | 'group' | 'global', windowId, spaceId, favId, tabId, groupId }

// identifiant du menu -> clé de traduction
const SIDE_ITEMS = {
  'arb-fav-reset': 'menuFavReset',
  'arb-fav-close': 'menuFavClose',
  'arb-fav-update': 'menuFavUpdate',
  'arb-fav-share': 'menuFavShare',
  'arb-fav-remove': 'menuFavRemove',
  'arb-space-edit': 'menuSpaceEdit',
  'arb-space-left': 'menuSpaceLeft',
  'arb-space-right': 'menuSpaceRight',
  'arb-group-edit': 'menuGroupEdit',
  'arb-group-newtab': 'menuGroupNewTab',
  'arb-group-collapse': 'menuGroupCollapse',
  'arb-group-ungroup': 'menuGroupUngroup',
  'arb-group-close': 'menuGroupClose',
  'arb-new-space': 'menuNewSpace',
  'arb-clear': 'menuClearSpace',
  'arb-settings': 'menuSettings',
};

// Menu d'onglet, dans l'ordre de celui de Firefox. null = séparateur.
// Les entrées marquées native ne sont affichées que depuis la barre Arbalète.
const TAB_ITEMS = [
  { id: 'arb-tab-newtab', key: 'menuTabNewTab', native: true },
  { id: 'arb-tab-newgroup', key: 'menuNewGroup', native: true, groups: true },
  { id: 'arb-tab-addgroup', key: 'menuAddToGroup', native: true, groups: true },
  { id: 'arb-tab-ungroup', key: 'menuUngroupTab', native: true, groups: true },
  { id: 'arb-tab-split', key: 'menuTabSplit', native: true },
  null,
  { id: 'arb-tab-reload', key: 'menuTabReload', native: true },
  { id: 'arb-tab-mute', key: 'menuTabMute', native: true },
  { id: 'arb-tab-pin', key: 'menuTabPin', native: true },
  { id: 'arb-tab-discard', key: 'menuTabDiscard', native: true },
  { id: 'arb-tab-duplicate', key: 'menuTabDuplicate', native: true },
  null,
  { id: 'arb-fav', key: 'menuAddFavorite' },
  { id: 'arb-move', key: 'menuMoveTab' },
  { id: 'arb-tab-copyurl', key: 'menuTabCopyUrl', native: true },
  { id: 'arb-tab-moveopts', key: 'menuTabMoveOptions', native: true },
  { id: 'arb-tab-container', key: 'menuTabContainer', native: true },
  { id: 'arb-tab-selectall', key: 'menuTabSelectAll', native: true },
  null,
  { id: 'arb-tab-archive', key: 'menuTabArchive', native: true },
  { id: 'arb-tab-close', key: 'menuTabClose', native: true },
  { id: 'arb-tab-closedupes', key: 'menuTabCloseDuplicates', native: true },
  { id: 'arb-tab-closeopts', key: 'menuTabCloseOptions', native: true },
  { id: 'arb-tab-undo', key: 'menuTabUndoClose', native: true },
];

let menusBuilding = Promise.resolve();
function buildMenus() {
  menusBuilding = menusBuilding.then(async () => {
    await browser.menus.removeAll();
    let separator = 0;
    for (const item of TAB_ITEMS) {
      if (!item) {
        browser.menus.create({ id: `arb-tab-sep-${separator++}`, type: 'separator', contexts: ['tab'] });
        continue;
      }
      if (item.groups && !browser.tabGroups) continue;
      browser.menus.create({ id: item.id, title: t(item.key), contexts: ['tab'] });
    }
    for (const s of spaces) {
      browser.menus.create({ id: `arb-move:${s.id}`, parentId: 'arb-move', title: s.name, contexts: ['tab'] });
    }
    for (const [id, key] of [['start', 'menuTabMoveStart'], ['end', 'menuTabMoveEnd'], ['window', 'menuTabMoveWindow']]) {
      browser.menus.create({ id: `arb-tab-moveopts:${id}`, parentId: 'arb-tab-moveopts', title: t(key), contexts: ['tab'] });
    }
    for (const [id, key] of [['above', 'menuTabCloseAbove'], ['below', 'menuTabCloseBelow'], ['others', 'menuTabCloseOthers']]) {
      browser.menus.create({ id: `arb-tab-closeopts:${id}`, parentId: 'arb-tab-closeopts', title: t(key), contexts: ['tab'] });
    }

    for (const [id, key] of Object.entries(SIDE_ITEMS)) {
      browser.menus.create({ id, title: t(key), contexts: ['all'], viewTypes: ['sidebar', 'popup', 'tab'], visible: false });
      if (id === 'arb-group-ungroup') {
        browser.menus.create({ id: 'arb-group-move', title: t('menuGroupMove'), contexts: ['all'], viewTypes: ['sidebar', 'popup', 'tab'], visible: false });
        for (const s of spaces) {
          browser.menus.create({ id: `arb-group-move:${s.id}`, parentId: 'arb-group-move', title: s.name, contexts: ['all'] });
        }
      }
    }
  }).catch(() => {});
  return menusBuilding;
}

// Onglets visés par le menu : la multi-sélection si l'onglet cliqué en fait partie.
async function menuTabs(tab) {
  if (!tab.highlighted) return [tab];
  const selected = await browser.tabs.query({ windowId: tab.windowId, highlighted: true });
  return selected.length > 1 ? selected : [tab];
}

// Onglets de l'espace de cet onglet, dans l'ordre de la barre (hors épinglés).
async function spaceTabs(tab) {
  const spaceId = tabSpace.get(tab.id);
  return (await browser.tabs.query({ windowId: tab.windowId }))
    .filter((x) => !x.pinned && tabSpace.get(x.id) === spaceId);
}

// Sous-menus calculés à l'ouverture : groupes de la fenêtre, conteneurs.
let dynamicMenuIds = [];
async function updateTabMenu(tab, fromSidebar) {
  await Promise.all(dynamicMenuIds.map((id) => browser.menus.remove(id).catch(() => {})));
  dynamicMenuIds = [];
  const add = (props) => {
    browser.menus.create({ contexts: ['tab'], ...props });
    dynamicMenuIds.push(props.id);
  };
  const targets = await menuTabs(tab);
  const many = targets.length > 1;
  const count = (key, pluralKey) => (many ? t(pluralKey, targets.length) : t(key));
  const updates = {};

  for (const item of TAB_ITEMS) if (item && item.native) updates[item.id] = { visible: fromSidebar };

  if (browser.tabGroups && fromSidebar) {
    const groups = (await browser.tabGroups.query({ windowId: tab.windowId }).catch(() => []))
      .filter((g) => g.id !== tab.groupId);
    for (const g of groups) add({ id: `arb-tab-addgroup:${g.id}`, parentId: 'arb-tab-addgroup', title: g.title || t('unnamedGroup') });
    updates['arb-tab-addgroup'] = { visible: groups.length > 0 };
    updates['arb-tab-ungroup'] = { visible: targets.some((x) => x.groupId !== undefined && x.groupId !== -1) };
  }

  if (fromSidebar) {
    let containers = [];
    try {
      containers = await browser.contextualIdentities.query({});
    } catch (e) {
      // conteneurs désactivés
    }
    add({ id: 'arb-tab-container:firefox-default', parentId: 'arb-tab-container', title: t('menuTabNoContainer') });
    for (const c of containers) add({ id: `arb-tab-container:${c.cookieStoreId}`, parentId: 'arb-tab-container', title: c.name });
    updates['arb-tab-container'] = { visible: containers.length > 0 && !many };

    updates['arb-tab-reload'] = { visible: true, title: count('menuTabReload', 'menuTabsReload') };
    updates['arb-tab-mute'] = { visible: true, title: count(tab.mutedInfo.muted ? 'menuTabUnmute' : 'menuTabMute', tab.mutedInfo.muted ? 'menuTabsUnmute' : 'menuTabsMute') };
    updates['arb-tab-pin'] = { visible: true, title: count(tab.pinned ? 'menuTabUnpin' : 'menuTabPin', tab.pinned ? 'menuTabsUnpin' : 'menuTabsPin') };
    updates['arb-tab-discard'] = { visible: true, title: count('menuTabDiscard', 'menuTabsDiscard'), enabled: targets.some((x) => !x.discarded) };
    updates['arb-tab-archive'] = { visible: true, title: count('menuTabArchive', 'menuTabsArchive'), enabled: targets.some(archivable) };
    updates['arb-tab-split'] = {
      visible: true,
      title: t(targets.length >= 2 ? 'menuTabsSplit' : 'menuTabSplit'),
      enabled: targets.length <= 2,
    };
    updates['arb-tab-duplicate'] = { visible: true, title: count('menuTabDuplicate', 'menuTabsDuplicate') };
    updates['arb-tab-close'] = { visible: true, title: count('menuTabClose', 'menuTabsClose') };
    updates['arb-tab-undo'] = { visible: true, enabled: (await browser.sessions.getRecentlyClosed({ maxResults: 1 })).length > 0 };
  }
  await Promise.all(Object.entries(updates).map(([id, u]) => browser.menus.update(id, u).catch(() => {})));
}

browser.menus.onShown.addListener(async (info, tab) => {
  const fromSidebar = (info.pageUrl || '').startsWith(SIDEBAR_PAGE) || info.viewType === 'sidebar';
  if (info.contexts.includes('tab') && tab) await updateTabMenu(tab, fromSidebar).catch(() => {});
  const t = (info.pageUrl || '').startsWith(SIDEBAR_PAGE) && !info.contexts.includes('tab') ? lastMenuTarget : null;
  const kind = t && t.kind;
  const index = t ? spaces.findIndex((s) => s.id === t.spaceId) : -1;
  const visible = {
    'arb-fav-reset': kind === 'fav' && !!t.tabId,
    'arb-fav-close': kind === 'fav' && !!t.tabId,
    'arb-fav-update': kind === 'fav' && !!t.tabId,
    'arb-fav-share': kind === 'fav',
    'arb-fav-remove': kind === 'fav',
    'arb-space-edit': kind === 'space',
    'arb-space-left': kind === 'space' && index > 0,
    'arb-space-right': kind === 'space' && index < spaces.length - 1,
    'arb-group-edit': kind === 'group',
    'arb-group-newtab': kind === 'group',
    'arb-group-collapse': kind === 'group',
    'arb-group-ungroup': kind === 'group',
    'arb-group-move': kind === 'group' && spaces.length > 1,
    'arb-group-close': kind === 'group',
    'arb-new-space': kind === 'space' || kind === 'global',
    'arb-clear': kind === 'global',
    'arb-settings': kind === 'space' || kind === 'global',
  };
  await Promise.all(Object.entries(visible).map(([id, v]) => browser.menus.update(id, { visible: v }).catch(() => {})));
  if (kind === 'fav') {
    // (t est ici la cible du menu : on traduit sans passer par t())
    await browser.menus.update('arb-fav-share', { title: browser.i18n.getMessage(t.shared ? 'menuFavUnshare' : 'menuFavShare') }).catch(() => {});
  }
  browser.menus.refresh();
});

// Actions du menu d'onglet recréé. targets = onglets visés (multi-sélection comprise).
async function tabAction(id, tab) {
  const targets = await menuTabs(tab);
  const ids = targets.map((x) => x.id);
  const [action, arg] = id.slice('arb-tab-'.length).split(':');
  switch (action) {
    case 'newtab': {
      const created = await newTab(tab.windowId, tabSpace.get(tab.id) || activeSpace(tab.windowId));
      return browser.tabs.move(created.id, { index: tab.index + 1 });
    }
    case 'newgroup': {
      // Comme Firefox : on crée le groupe puis on propose de le nommer.
      const groupId = await browser.tabs.group({ tabIds: ids });
      return openPopup(`group=${groupId}&win=${tab.windowId}`, 300);
    }
    case 'addgroup': return browser.tabs.group({ groupId: Number(arg), tabIds: ids });
    case 'ungroup': return browser.tabs.ungroup(ids);
    case 'split': return openSplit(tab, targets);
    case 'reload': return Promise.all(ids.map((x) => browser.tabs.reload(x)));
    case 'mute': return Promise.all(ids.map((x) => browser.tabs.update(x, { muted: !tab.mutedInfo.muted })));
    case 'pin': return Promise.all(ids.map((x) => browser.tabs.update(x, { pinned: !tab.pinned })));
    case 'discard':
      // Firefox ne décharge pas l'onglet affiché : on passe d'abord à un autre onglet de l'espace.
      await leaveTabs(tab, ids);
      return browser.tabs.discard(ids);
    case 'archive':
      await leaveTabs(tab, ids);
      return archiveTabs(targets.filter(archivable));
    case 'duplicate': return Promise.all(ids.map((x) => browser.tabs.duplicate(x)));
    case 'copyurl': {
      await navigator.clipboard.writeText(targets.map((x) => x.url).join('\n'));
      return browser.runtime.sendMessage({ type: 'toast', text: t('urlCopied') }).catch(() => {});
    }
    case 'moveopts': {
      if (arg === 'window') {
        const win = await browser.windows.create({ tabId: ids[0] });
        if (ids.length > 1) await browser.tabs.move(ids.slice(1), { windowId: win.id, index: -1 });
        return undefined;
      }
      const inSpace = await spaceTabs(tab);
      const index = arg === 'start' ? (inSpace[0] ? inSpace[0].index : 0) : -1;
      return browser.tabs.move(ids, { index });
    }
    case 'container': {
      if (!arg) return undefined;
      const replacement = await browser.tabs.create({
        windowId: tab.windowId,
        index: tab.index + 1,
        url: /^(https?|file|ftp):/.test(tab.url) ? tab.url : undefined,
        cookieStoreId: arg,
        active: tab.active,
      });
      assign(replacement.id, tabSpace.get(tab.id) || activeSpace(tab.windowId));
      return browser.tabs.remove(tab.id);
    }
    case 'selectall': {
      const inSpace = await spaceTabs(tab);
      const active = inSpace.find((x) => x.active) || tab;
      return highlightTabs(tab.windowId, [active.id, ...inSpace.filter((x) => x !== active).map((x) => x.id)]);
    }
    case 'close': return browser.tabs.remove(ids);
    case 'closedupes': {
      const seen = new Set();
      const dupes = [];
      for (const x of (await spaceTabs(tab)).sort((a, b) => Number(b.active) - Number(a.active))) {
        if (seen.has(x.url)) dupes.push(x.id);
        else seen.add(x.url);
      }
      return browser.tabs.remove(dupes);
    }
    case 'closeopts': {
      const inSpace = await spaceTabs(tab);
      const keep = new Set(ids);
      const pos = inSpace.findIndex((x) => x.id === tab.id);
      const toClose = inSpace.filter((x, i) => !keep.has(x.id) && !tabFav.has(x.id)
        && (arg === 'others' || (arg === 'above' ? i < pos : i > pos)));
      return browser.tabs.remove(toClose.map((x) => x.id));
    }
    case 'undo': return browser.sessions.restore();
  }
  return undefined;
}

// --- Vue scindée maison (page split/split.html à deux cadres) ------------------------------
// La vue scindée native de Firefox n'est pas accessible aux extensions. Ici : un onglet
// d'extension qui affiche deux sites. Il faut la permission optionnelle « tous les
// sites » (demandée au premier usage par la page elle-même) pour :
//  - retirer X-Frame-Options et frame-ancestors, qui interdisent aux sites d'être
//    affichés dans un cadre, uniquement pour les cadres de cette page ;
//  - suivre les navigations des cadres (adresse affichée, « Séparer »).

async function openSplit(tab, targets) {
  // Les pages internes (nouvel onglet, about:…) ne peuvent pas s'afficher dans un
  // cadre : leur côté s'ouvre vide, avec le choix d'un onglet ou d'une adresse.
  const [left, right] = targets.slice(0, 2);
  const web = (x) => (x && /^(https?|file):/.test(x.url) ? x.url : '');
  const q = new URLSearchParams({ sid: uid() });
  if (web(left)) q.set('left', web(left));
  if (web(right)) q.set('right', web(right));
  const props = { windowId: tab.windowId, index: left.index, url: `${SPLIT_PAGE}?${q}`, active: true };
  let split;
  try {
    split = await browser.tabs.create({ ...props, cookieStoreId: left.cookieStoreId });
  } catch (e) {
    split = await browser.tabs.create(props);
  }
  assign(split.id, tabSpace.get(left.id) || activeSpace(tab.windowId));
  await browser.tabs.remove(targets.slice(0, 2).map((x) => x.id));
}

function isSplitFrame(details) {
  if (details.type !== 'sub_frame' || details.parentFrameId !== 0) return false;
  const parent = details.frameAncestors && details.frameAncestors[0]
    ? details.frameAncestors[0].url
    : details.documentUrl;
  return !!parent && parent.startsWith(SPLIT_PAGE);
}

function allowFraming(details) {
  if (!isSplitFrame(details)) return {};
  browser.runtime.sendMessage({ type: 'splitFrame', tabId: details.tabId, frameId: details.frameId, url: details.url })
    .catch(() => {});
  const responseHeaders = [];
  for (const header of details.responseHeaders) {
    const name = header.name.toLowerCase();
    if (name === 'x-frame-options') continue;
    if (name === 'content-security-policy') {
      const kept = header.value.split(';').filter((d) => !d.trim().toLowerCase().startsWith('frame-ancestors'));
      responseHeaders.push({ name: header.name, value: kept.join(';') });
      continue;
    }
    responseHeaders.push(header);
  }
  return { responseHeaders };
}

// Une page d'extension n'envoie pas de Referer à ses cadres. Certains sites l'exigent
// (le lecteur intégré de YouTube affiche sinon « erreur 153 ») : on annonce le site
// le dépôt d'Arbalète comme site intégrateur (YouTube refuse youtube.com lui-même).
const EMBEDDER = 'https://github.com/valentin-gosselin/arbalete';

function addReferer(details) {
  if (!isSplitFrame(details)) return {};
  const requestHeaders = details.requestHeaders.filter((h) => h.name.toLowerCase() !== 'referer');
  try {
    const { hostname, origin } = new URL(details.url);
    const youtube = /(^|\.)youtube(-nocookie)?\.com$/.test(hostname);
    requestHeaders.push({ name: 'Referer', value: youtube ? EMBEDDER : `${origin}/` });
  } catch (e) {
    return {};
  }
  return { requestHeaders };
}

// Firefox ferme tous les onglets d'une extension quand elle est rechargée ou mise à
// jour. On garde donc la liste des vues scindées ouvertes (storage.local) pour les
// rouvrir ensuite. Chaque vue a un identifiant « sid » dans son adresse.
const splitTabs = new Map(); // tabId -> sid

async function rememberSplit(tabId, sid, url) {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  splitTabs.set(tabId, sid);
  const { splits = {} } = await browser.storage.local.get('splits');
  splits[sid] = { url, windowId: tab.windowId, index: tab.index, spaceId: tabSpace.get(tabId) || null, cookieStoreId: tab.cookieStoreId };
  await browser.storage.local.set({ splits });
}

async function forgetSplit(sid) {
  const { splits = {} } = await browser.storage.local.get('splits');
  delete splits[sid];
  await browser.storage.local.set({ splits });
}

// Onglet fermé : on attend un peu, car si c'est l'extension qui s'arrête (mise à
// jour), ce délai n'arrive jamais à son terme et la vue reste mémorisée.
function onSplitTabRemoved(tabId) {
  const sid = splitTabs.get(tabId);
  if (!sid) return;
  splitTabs.delete(tabId);
  setTimeout(() => forgetSplit(sid), 2000);
}

async function restoreSplits() {
  const { splits = {} } = await browser.storage.local.get('splits');
  const open = new Set();
  for (const tab of await browser.tabs.query({})) {
    if (!tab.url.startsWith(SPLIT_PAGE)) continue;
    const sid = new URL(tab.url).searchParams.get('sid');
    if (sid) {
      open.add(sid);
      splitTabs.set(tab.id, sid);
    }
  }
  const windows = await browser.windows.getAll({ windowTypes: ['normal'] });
  for (const [sid, record] of Object.entries(splits)) {
    if (open.has(sid)) continue;
    const win = windows.find((w) => w.id === record.windowId) || windows[0];
    if (!win) continue;
    const props = { windowId: win.id, index: record.index, url: record.url, active: false };
    let tab;
    try {
      tab = await browser.tabs.create({ ...props, cookieStoreId: record.cookieStoreId });
    } catch (e) {
      tab = await browser.tabs.create(props).catch(() => null);
    }
    if (!tab) continue;
    splitTabs.set(tab.id, sid);
    if (record.spaceId && getSpace(record.spaceId)) assign(tab.id, record.spaceId);
  }
  for (const windowId of activeByWindow.keys()) await applyVisibility(windowId).catch(() => {});
  notify();
}

let framingListener = false;
async function enableSplitSupport() {
  if (framingListener || !browser.webRequest) return;
  const granted = await browser.permissions.contains({
    permissions: ['webRequest', 'webRequestBlocking'],
    origins: ['<all_urls>'],
  });
  if (!granted) return;
  browser.webRequest.onHeadersReceived.addListener(allowFraming, { urls: ['<all_urls>'], types: ['sub_frame'] }, ['blocking', 'responseHeaders']);
  browser.webRequest.onBeforeSendHeaders.addListener(addReferer, { urls: ['<all_urls>'], types: ['sub_frame'] }, ['blocking', 'requestHeaders']);
  if (browser.contentScripts) {
    await browser.contentScripts.register({
      matches: ['<all_urls>'],
      js: [{ file: 'split/frame.js' }],
      allFrames: true,
      runAt: 'document_start',
    }).catch(() => {});
  }
  framingListener = true;
}
enableSplitSupport();
browser.permissions.onAdded.addListener(enableSplitSupport);

// --- Recherche rapide -------------------------------------------------------------------
// Alt+K : calque centré injecté dans l'onglet actif (permission activeTab, accordée par
// le raccourci). Vue scindée d'Arbalète : la page affiche le calque elle-même.
// Pages où Firefox interdit toute extension (about:, sites de Mozilla…) : panneau sous
// l'icône d'Arbalète. browserAction.openPopup() n'est permis que pendant le geste de
// l'utilisateur, avant tout « await » : la décision se prend donc sur un cache
// (fenêtre active et adresse de son onglet actif) tenu à jour en continu.

const PROTECTED_HOSTS = [
  'accounts-static.cdn.mozilla.net', 'accounts.firefox.com', 'addons.cdn.mozilla.net', 'addons.mozilla.org',
  'api.accounts.firefox.com', 'content.cdn.mozilla.net', 'discovery.addons.mozilla.org', 'install.mozilla.org',
  'oauth.accounts.firefox.com', 'profile.accounts.firefox.com', 'support.mozilla.org', 'sync.services.mozilla.com',
];

function canInject(url) {
  try {
    const u = new URL(url);
    return /^(https?|file):$/.test(u.protocol) && !PROTECTED_HOSTS.includes(u.hostname) && !u.pathname.endsWith('.pdf');
  } catch (e) {
    return false;
  }
}

let focusedWindowId = null;
const activeTabByWindow = new Map(); // windowId -> { id, url }

browser.windows.getLastFocused().then((w) => { focusedWindowId = w.id; });
browser.tabs.query({ active: true }).then((tabs) => {
  for (const tab of tabs) activeTabByWindow.set(tab.windowId, { id: tab.id, url: tab.url });
});
browser.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== browser.windows.WINDOW_ID_NONE) focusedWindowId = windowId;
});
browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
  browser.tabs.get(tabId).then((tab) => activeTabByWindow.set(windowId, { id: tab.id, url: tab.url })).catch(() => {});
});
browser.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (tab.active && change.url) activeTabByWindow.set(tab.windowId, { id: tabId, url: change.url });
}, { properties: ['url'] });

// Appelée pendant le geste de l'utilisateur : surtout pas d'await avant openPopup().
function openPalette(windowId) {
  const tab = activeTabByWindow.get(windowId);
  if (tab && tab.url.startsWith(SPLIT_PAGE)) {
    browser.runtime.sendMessage({ type: 'togglePalette', tabId: tab.id }).catch(() => {});
    return;
  }
  if (tab && canInject(tab.url)) {
    browser.tabs.executeScript(tab.id, { code: `window.arbaleteWindowId = ${Number(windowId)};` })
      .then(() => browser.tabs.executeScript(tab.id, { file: 'palette/overlay.js' }))
      .catch(() => {});
    return;
  }
  browser.browserAction.openPopup().catch(() => {});
}

// Écouteur à part et sans await : le raccourci doit rester un « geste » pour Firefox.
browser.commands.onCommand.addListener((command) => {
  if (command === 'open-palette' && focusedWindowId !== null) openPalette(focusedWindowId);
});

// Si l'onglet affiché fait partie de ceux qu'on va décharger ou archiver, on active
// d'abord le plus récent des autres onglets de l'espace (sinon Firefox choisirait un
// onglet voisin, peut-être d'un autre espace), ou un nouvel onglet.
async function leaveTabs(tab, ids) {
  const [active] = await browser.tabs.query({ windowId: tab.windowId, active: true });
  if (!active || !ids.includes(active.id)) return;
  const others = (await spaceTabs(active)).filter((x) => !ids.includes(x.id))
    .sort((a, b) => b.lastAccessed - a.lastAccessed);
  if (others.length) await browser.tabs.update(others[0].id, { active: true });
  else await newTab(tab.windowId, tabSpace.get(active.id) || activeSpace(tab.windowId));
}

// Multi-sélection : celle de Firefox (onglets « surlignés »). Le premier de la
// liste doit être l'onglet actif, sinon Firefox active un autre onglet.
async function highlightTabs(windowId, tabIds) {
  const tabs = await browser.tabs.query({ windowId });
  const indexes = tabIds.map((id) => tabs.find((x) => x.id === id)).filter(Boolean).map((x) => x.index);
  if (indexes.length) await browser.tabs.highlight({ windowId, tabs: indexes, populate: false });
}

browser.menus.onClicked.addListener(async (info, tab) => {
  await ready;
  const id = String(info.menuItemId);
  if (id === 'arb-fav' && tab) {
    for (const x of await menuTabs(tab)) await addFavorite(x.id);
    return undefined;
  }
  if (id.startsWith('arb-move:') && tab) {
    for (const x of await menuTabs(tab)) await moveTab(x.id, id.slice('arb-move:'.length));
    return undefined;
  }
  if (id.startsWith('arb-tab-') && tab) return tabAction(id, tab);
  const t = lastMenuTarget;
  if (!t) return undefined;
  if (id.startsWith('arb-group')) return groupAction(id, t);
  const index = spaces.findIndex((s) => s.id === t.spaceId);
  switch (id) {
    case 'arb-fav-reset': return resetFavorite(t.tabId);
    case 'arb-fav-close': return browser.tabs.remove(t.tabId);
    case 'arb-fav-remove': return removeFavorite(t.spaceId, t.favId);
    case 'arb-fav-update': return updateFavorite(t.spaceId, t.favId, t.tabId);
    case 'arb-fav-share': return toggleSharedFavorite(t.spaceId, t.favId);
    case 'arb-space-edit': return editSpace(t.windowId, t.spaceId);
    case 'arb-space-left':
    case 'arb-space-right': {
      const ids = spaces.map((s) => s.id);
      const [moved] = ids.splice(index, 1);
      ids.splice(index + (id === 'arb-space-left' ? -1 : 1), 0, moved);
      return reorderSpaces(ids);
    }
    case 'arb-new-space': {
      const spaceId = await createSpace(t.windowId);
      return editSpace(t.windowId, spaceId);
    }
    case 'arb-clear': return handlers.clearSpace({ windowId: t.windowId, spaceId: activeSpace(t.windowId) });
    case 'arb-settings': return openSettings(t.windowId);
  }
  return undefined;
});

// Actions du clic droit sur un groupe d'onglets (Firefox ne prête pas son menu de
// groupe aux extensions, on reproduit l'essentiel).
async function groupAction(id, t) {
  const tabs = (await browser.tabs.query({ windowId: t.windowId })).filter((tab) => tab.groupId === t.groupId);
  const tabIds = tabs.map((tab) => tab.id);
  if (id.startsWith('arb-group-move:')) {
    const spaceId = id.slice('arb-group-move:'.length);
    for (const tabId of tabIds) assign(tabId, spaceId);
    await ensureActiveInSpace(t.windowId);
    await applyVisibility(t.windowId);
    return notify();
  }
  switch (id) {
    case 'arb-group-edit':
      return openPopup(`group=${t.groupId}&win=${t.windowId}`, 300);
    case 'arb-group-newtab': {
      const tab = await newTab(t.windowId, activeSpace(t.windowId));
      return browser.tabs.group({ groupId: t.groupId, tabIds: [tab.id] });
    }
    case 'arb-group-collapse': {
      const group = await browser.tabGroups.get(t.groupId);
      return browser.tabGroups.update(t.groupId, { collapsed: !group.collapsed });
    }
    case 'arb-group-ungroup':
      return browser.tabs.ungroup(tabIds);
    case 'arb-group-close':
      return browser.tabs.remove(tabIds);
  }
}

// --- Messages de la barre latérale --------------------------------------------

const handlers = {
  getState: (m) => getState(m.windowId),
  switchSpace: (m) => switchSpace(m.windowId, m.spaceId),
  switchRelative: (m) => switchRelative(m.windowId, m.delta),
  newTab: (m) => newTab(m.windowId, activeSpace(m.windowId), m.url).then(() => undefined),
  activateTab: (m) => browser.tabs.update(m.tabId, { active: true }).then(() => undefined),
  closeTab: (m) => browser.tabs.remove(m.tabId),
  moveTab: (m) => moveTab(m.tabId, m.spaceId),
  reorderTab: (m) => browser.tabs.move(m.tabId, { index: m.index }).then(() => undefined),
  openFavorite: (m) => openFavorite(m.windowId, m.spaceId, m.favId),
  addFavorite: (m) => addFavorite(m.tabId),
  removeFavorite: (m) => removeFavorite(m.spaceId, m.favId),
  resetFavorite: (m) => resetFavorite(m.tabId),
  createSpace: (m) => createSpace(m.windowId),
  saveSpace: (m) => upsertSpace(m.space),
  deleteSpace: (m) => deleteSpace(m.spaceId),
  reorderSpaces: (m) => reorderSpaces(m.ids),
  editSpace: (m) => editSpace(m.windowId, m.spaceId).then(() => undefined),
  openSettings: (m) => openSettings(m.windowId).then(() => undefined),
  openSetup: (m) => openSetup(m.windowId).then(() => undefined),
  setMenuTarget: (m) => { lastMenuTarget = m.target; },
  enableSplit: () => enableSplitSupport(),
  openPalette: (m) => openPalette(m.windowId),
  // Actions de la recherche rapide qui demandent des droits absents de son cadre.
  reopenClosed: () => browser.sessions.restore().then(() => undefined),
  openShortcuts: () => (browser.commands.openShortcutSettings ? browser.commands.openShortcutSettings() : undefined),
  webSearch: (m) => browser.search.query({ text: m.text, disposition: 'NEW_TAB' }),
  // Suggestions du moteur choisi dans les réglages (format OpenSearch, comme Firefox).
  suggest: async (m) => {
    const { suggestUrl } = await browser.storage.local.get('suggestUrl');
    if (!suggestUrl || !m.text) return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const url = suggestUrl.replace(/\{searchTerms\}|%s/g, encodeURIComponent(m.text));
      const data = await (await fetch(url, { signal: controller.signal, credentials: 'omit' })).json();
      const list = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : (Array.isArray(data) ? data : []);
      return list.filter((x) => typeof x === 'string').slice(0, 8);
    } catch (e) {
      return [];
    } finally {
      clearTimeout(timer);
    }
  },
  searchHistory: async (m) => {
    if (!browser.history || !(await browser.permissions.contains({ permissions: ['history'] }))) return [];
    const visits = await browser.history.search({ text: m.text, maxResults: 30, startTime: 0 });
    return visits.map((v) => ({ url: v.url, title: v.title }));
  },
  paletteCanInject: (m) => canInject(m.url),
  // Navigation interne d'un cadre (frame.js) : relayée à la page de vue scindée.
  splitFrameChanged: (m, sender) => {
    if (!sender.tab || !splitTabs.has(sender.tab.id) && !(sender.tab.url || '').startsWith(SPLIT_PAGE)) return undefined;
    return browser.runtime.sendMessage({ type: 'splitFrame', tabId: sender.tab.id, frameId: sender.frameId, url: m.url, title: m.title })
      .catch(() => {});
  },
  splitState: (m, sender) => rememberSplit(sender.tab.id, m.sid, m.url),
  highlight: (m) => highlightTabs(m.windowId, m.tabIds),
  // Actions du menu d'onglet, depuis la recherche rapide.
  tabAction: async (m) => tabAction('arb-tab-' + m.action, await browser.tabs.get(m.tabId)),
  toggleMute: (m) => browser.tabs.update(m.tabId, { muted: m.muted }).then(() => undefined),
  toggleGroup: (m) => browser.tabGroups.update(m.groupId, { collapsed: m.collapsed }).then(() => undefined),
  exportSpaces: () => spaces.map(({ cookieStoreId, ...rest }) => rest),
  importSpaces: (m) => importSpaces(m.spaces),
  clearSpace: async (m) => {
    // « Nettoyer » : range dans l'archive les onglets de l'espace (hors favoris et
    // épinglés), les pages internes sont simplement fermées.
    const tabs = (await browser.tabs.query({ windowId: m.windowId }))
      .filter((t) => !t.pinned && tabSpace.get(t.id) === m.spaceId && !tabFav.has(t.id));
    await newTab(m.windowId, m.spaceId);
    await archiveTabs(tabs.filter(archivable));
    await browser.tabs.remove(tabs.filter((t) => !archivable(t)).map((t) => t.id));
  },
  getArchive: () => readArchive(),
  openArchive: (m) => openArchive(m.windowId).then(() => undefined),
  reopenArchived: (m) => reopenArchived(m.windowId, m.spaceId, m.url),
  removeArchived: (m) => removeArchived(m.spaceId, m.url),
  archiveDelays: () => ARCHIVE_DELAYS,
  addFavoriteUrl: (m) => addFavoriteUrl(m.windowId, m.url, m.title),
  getStats: async () => (await browser.storage.local.get('stats')).stats || {},
};

browser.runtime.onMessage.addListener(async (message, sender) => {
  await ready;
  const handler = handlers[message.type];
  if (handler) return handler(message, sender);
  return undefined;
});
