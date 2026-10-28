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
const BLANK_URLS = ['about:newtab', 'about:home'];

let spaces = [];
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
  const payload = { order: spaces.map((s) => s.id) };
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

async function openFavorite(windowId, spaceId, favId) {
  const space = getSpace(spaceId);
  const fav = space && space.favorites.find((f) => f.id === favId);
  if (!fav) return;
  const tabs = await browser.tabs.query({ windowId });
  const existing = tabs.find((t) => tabFav.get(t.id) === favId);
  if (existing) {
    await browser.tabs.update(existing.id, { active: true });
    return;
  }
  const tab = await newTab(windowId, spaceId, fav.url);
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

async function removeFavorite(spaceId, favId) {
  const space = getSpace(spaceId);
  if (!space) return;
  space.favorites = space.favorites.filter((f) => f.id !== favId);
  for (const [tabId, id] of tabFav) if (id === favId) setFav(tabId, null);
  await saveSpaces();
}

// Si l'onglet d'un favori a changé de page, on le remet sur l'adresse du favori.
async function resetFavorite(tabId) {
  const space = getSpace(tabSpace.get(tabId));
  const fav = space && space.favorites.find((f) => f.id === tabFav.get(tabId));
  if (fav) await browser.tabs.update(tabId, { url: fav.url });
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
    groups,
    activeSpaceId: activeSpace(windowId),
    containers: containers.map((c) => ({ id: c.cookieStoreId, name: c.name, color: c.colorCode })),
    tabs: tabs.map((t) => ({
      id: t.id,
      index: t.index,
      title: t.title,
      url: t.url,
      favIconUrl: t.favIconUrl || '',
      active: t.active,
      pinned: t.pinned,
      audible: t.audible,
      muted: !!(t.mutedInfo && t.mutedInfo.muted),
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

browser.tabs.onRemoved.addListener((tabId) => {
  tabSpace.delete(tabId);
  tabFav.delete(tabId);
  notify();
});

browser.tabs.onUpdated.addListener(
  (tabId, change) => {
    if (change.pinned === false && !tabSpace.has(tabId)) {
      browser.tabs.get(tabId).then((t) => assign(tabId, activeSpace(t.windowId)));
    }
    notify();
  },
  { properties: ['title', 'favIconUrl', 'status', 'pinned', 'audible', 'mutedInfo', 'url'] }
);

browser.tabs.onMoved.addListener(notify);

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

const editSpace = (windowId, spaceId) => openPopup(`edit=${encodeURIComponent(spaceId)}&win=${windowId}`, 620);
const openSettings = (windowId) => openPopup(`settings=1&win=${windowId}`, 440);
const openSetup = (windowId) => openPopup(`setup=1&win=${windowId}`, 560);

// Première installation : on propose tout de suite de masquer les onglets natifs.
browser.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  await ready;
  const win = await browser.windows.getLastFocused();
  openSetup(win.id);
});

// --- Menus contextuels -------------------------------------------------------------
// Clic droit dans la barre : on affiche un vrai menu Firefox (menus.overrideContext),
// qui peut déborder de la barre. Sur un onglet, c'est le menu d'onglet natif de
// Firefox (groupes, épingler, recharger…) complété par les entrées d'Arbalète.

let lastMenuTarget = null; // { kind: 'fav' | 'space' | 'global', windowId, spaceId, favId, tabId }

// identifiant du menu -> clé de traduction
const SIDE_ITEMS = {
  'arb-fav-reset': 'menuFavReset',
  'arb-fav-close': 'menuFavClose',
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

let menusBuilding = Promise.resolve();
function buildMenus() {
  menusBuilding = menusBuilding.then(async () => {
    await browser.menus.removeAll();
    browser.menus.create({ id: 'arb-fav', title: t('menuAddFavorite'), contexts: ['tab'] });
    browser.menus.create({ id: 'arb-move', title: t('menuMoveTab'), contexts: ['tab'] });
    if (browser.tabGroups) {
      browser.menus.create({ id: 'arb-tab-newgroup', title: t('menuNewGroup'), contexts: ['tab'] });
      browser.menus.create({ id: 'arb-tab-addgroup', title: t('menuAddToGroup'), contexts: ['tab'] });
      browser.menus.create({ id: 'arb-tab-ungroup', title: t('menuUngroupTab'), contexts: ['tab'] });
    }
    for (const s of spaces) {
      browser.menus.create({ id: `arb-move:${s.id}`, parentId: 'arb-move', title: s.name, contexts: ['tab'] });
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

// Sous-menu « Ajouter au groupe » : les groupes de la fenêtre, recalculés à chaque ouverture.
let groupMenuIds = [];
async function updateTabGroupMenu(tab) {
  await Promise.all(groupMenuIds.map((id) => browser.menus.remove(id).catch(() => {})));
  groupMenuIds = [];
  const groups = (await browser.tabGroups.query({ windowId: tab.windowId }).catch(() => []))
    .filter((g) => g.id !== tab.groupId);
  for (const g of groups) {
    const id = `arb-tab-addgroup:${g.id}`;
    browser.menus.create({ id, parentId: 'arb-tab-addgroup', title: g.title || t('unnamedGroup'), contexts: ['tab'] });
    groupMenuIds.push(id);
  }
  const inGroup = tab.groupId !== undefined && tab.groupId !== -1;
  await browser.menus.update('arb-tab-addgroup', { visible: groups.length > 0 });
  await browser.menus.update('arb-tab-ungroup', { visible: inGroup });
}

browser.menus.onShown.addListener(async (info, tab) => {
  if (browser.tabGroups && info.contexts.includes('tab') && tab) await updateTabGroupMenu(tab).catch(() => {});
  const t = (info.pageUrl || '').startsWith(SIDEBAR_PAGE) && !info.contexts.includes('tab') ? lastMenuTarget : null;
  const kind = t && t.kind;
  const index = t ? spaces.findIndex((s) => s.id === t.spaceId) : -1;
  const visible = {
    'arb-fav-reset': kind === 'fav' && !!t.tabId,
    'arb-fav-close': kind === 'fav' && !!t.tabId,
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
  browser.menus.refresh();
});

browser.menus.onClicked.addListener(async (info, tab) => {
  await ready;
  const id = String(info.menuItemId);
  if (id === 'arb-fav' && tab) return addFavorite(tab.id);
  if (id.startsWith('arb-move:') && tab) return moveTab(tab.id, id.slice('arb-move:'.length));
  if (id === 'arb-tab-newgroup' && tab) {
    // Comme Firefox : on crée le groupe puis on propose de le nommer.
    const groupId = await browser.tabs.group({ tabIds: [tab.id] });
    return openPopup(`group=${groupId}&win=${tab.windowId}`, 300);
  }
  if (id.startsWith('arb-tab-addgroup:') && tab) {
    return browser.tabs.group({ groupId: Number(id.slice('arb-tab-addgroup:'.length)), tabIds: [tab.id] });
  }
  if (id === 'arb-tab-ungroup' && tab) return browser.tabs.ungroup([tab.id]);
  const t = lastMenuTarget;
  if (!t) return;
  if (id.startsWith('arb-group')) return groupAction(id, t);
  const index = spaces.findIndex((s) => s.id === t.spaceId);
  switch (id) {
    case 'arb-fav-reset': return resetFavorite(t.tabId);
    case 'arb-fav-close': return browser.tabs.remove(t.tabId);
    case 'arb-fav-remove': return removeFavorite(t.spaceId, t.favId);
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
  toggleMute: (m) => browser.tabs.update(m.tabId, { muted: m.muted }).then(() => undefined),
  toggleGroup: (m) => browser.tabGroups.update(m.groupId, { collapsed: m.collapsed }).then(() => undefined),
  exportSpaces: () => spaces.map(({ cookieStoreId, ...rest }) => rest),
  importSpaces: (m) => importSpaces(m.spaces),
  clearSpace: async (m) => {
    // « Nettoyer » : ferme les onglets de l'espace qui ne sont pas des favoris.
    const tabs = await browser.tabs.query({ windowId: m.windowId });
    const ids = tabs
      .filter((t) => !t.pinned && tabSpace.get(t.id) === m.spaceId && !tabFav.has(t.id))
      .map((t) => t.id);
    await newTab(m.windowId, m.spaceId);
    await browser.tabs.remove(ids);
  },
};

browser.runtime.onMessage.addListener(async (message) => {
  await ready;
  const handler = handlers[message.type];
  if (handler) return handler(message);
});
