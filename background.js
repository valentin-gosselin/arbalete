'use strict';

// Arbalète: each tab belongs to a space. Switching spaces hides the tabs of the other
// spaces (tabs.hide) instead of opening another window.
// Membership is remembered by Firefox (sessions.setTabValue), so it survives restarts
// and the reopening of a closed tab.

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
let shared = []; // favorites shared by all spaces
const activeByWindow = new Map(); // windowId -> spaceId
const tabSpace = new Map(); // tabId -> spaceId
const tabFav = new Map(); // tabId -> favId (tab opened from a favorite)

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

// Spaces go through Firefox Sync to follow the user from one PC to another (work / home).
// One key per space, because storage.sync limits each value to 8 KB.
// An imported icon (iconImage, a data URL of up to ~7 KB) gets its own key "icon:<id>",
// so that it does not eat into the 8 KB of the space itself.
function toStored(space) {
  const { iconImage, ...rest } = space;
  const favorites = space.favorites.map((f) => ({
    ...f,
    favIconUrl: f.favIconUrl && f.favIconUrl.length < 1500 ? f.favIconUrl : '',
  }));
  return { ...rest, favorites };
}

const validIconImage = (value) => (typeof value === 'string' && /^data:image\//.test(value) && value.length <= 7500 ? value : null);

async function saveSpaces() {
  const payload = { order: spaces.map((s) => s.id), shared: shared.map((f) => toStored({ favorites: [f] }).favorites[0]) };
  for (const s of spaces) {
    payload['space:' + s.id] = toStored(s);
    if (s.icon === 'image' && s.iconImage) payload['icon:' + s.id] = s.iconImage;
  }
  saving = true;
  try {
    await browser.storage.sync.set(payload);
    const all = await browser.storage.sync.get(null);
    const stale = Object.keys(all).filter((k) => (k.startsWith('space:') || k.startsWith('icon:')) && !payload[k]);
    if (stale.length) await browser.storage.sync.remove(stale);
  } finally {
    saving = false;
  }
  buildMenus();
  applyThemeEverywhere().catch(() => {});
  notify();
}

// Container ids differ from one Firefox profile to another: they are found by name,
// and the container is created if it does not exist here yet.
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
  for (const s of loaded) s.iconImage = s.icon === 'image' ? validIconImage(data['icon:' + s.id]) : null;
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

// --- Showing a space ---------------------------------------------------------

async function applyVisibility(windowId) {
  const spaceId = activeSpace(windowId);
  const tabs = await browser.tabs.query({ windowId });
  const show = [];
  const hide = [];
  for (const t of tabs) {
    if (t.pinned) continue; // Firefox refuses to hide pinned tabs
    (tabSpace.get(t.id) === spaceId ? show : hide).push(t.id);
  }
  if (show.length) await browser.tabs.show(show);
  if (hide.length) await browser.tabs.hide(hide).catch(() => {});
}

// The active tab must belong to the displayed space, otherwise Firefox cannot hide it.
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

// --- Favorites ("pinned" tabs specific to each space) ------------------------

// Favorites: those of the space, plus the favorites shared by all spaces (shared).
// A shared favorite opens in the space where the user clicks: one tab per space.
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

// Link dragged from a web page onto the tiles.
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

// "Update the favorite with this page": the favorite now points to the current page
// of its tab.
async function updateFavorite(spaceId, favId, tabId) {
  const found = findFavorite(spaceId, favId);
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!found || !tab || !/^https?:|^file:/.test(tab.url)) return;
  Object.assign(found.fav, { url: tab.url, title: tab.title || found.fav.title, favIconUrl: tab.favIconUrl || found.fav.favIconUrl });
  await saveSpaces();
}

// Shared favorite <-> space favorite.
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

// If a favorite's tab has moved to another page, put it back on the favorite's address.
async function resetFavorite(tabId) {
  const found = findFavorite(tabSpace.get(tabId), tabFav.get(tabId));
  if (found) await browser.tabs.update(tabId, { url: found.fav.url });
}

// --- Space management --------------------------------------------------------

async function upsertSpace(data) {
  if ('iconImage' in data) data.iconImage = validIconImage(data.iconImage);
  const existing = getSpace(data.id);
  if (existing) Object.assign(existing, data);
  else spaces.push({ favorites: [], cookieStoreId: null, ...data });
  await saveSpaces();
}

// The editor creates a space only when it is saved, with what was typed (data).
async function createSpace(windowId, data = {}) {
  const space = {
    name: t('newSpaceName'),
    icon: 'lucide:sparkles',
    color: PALETTE[spaces.length % PALETTE.length],
    cookieStoreId: null,
    ...data,
    iconImage: validIconImage(data.iconImage),
    id: uid(),
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
    // Containers disabled in Firefox: leave the list empty.
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
    nextColor: PALETTE[spaces.length % PALETTE.length],
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

// --- Startup -----------------------------------------------------------------

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

// Reopen the split views after a reload or an update of the extension.
// When Firefox starts (onStartup), session restore already takes care of it.
let browserStarting = false;
browser.runtime.onStartup.addListener(() => { browserStarting = true; });
ready.then(() => setTimeout(() => {
  if (!browserStarting) restoreSplits().catch(() => {});
}, 1500));

// Sidebar width: userChrome.css looks for an invisible character at the end of the
// sidebar title. ‌ = permanently expanded, ​ = widened on hover.
async function applyHoverOption() {
  const { expandOnHover, pinnedOpen } = await browser.storage.local.get(['expandOnHover', 'pinnedOpen']);
  const marker = pinnedOpen ? '‌' : expandOnHover ? '​' : '';
  await browser.sidebarAction.setTitle({ title: `Arbalète${marker}` });
}
applyHoverOption();
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.expandOnHover || changes.pinnedOpen)) applyHoverOption();
});

// --- Firefox events ----------------------------------------------------------

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
  // Small windows (space editing, login popups): outside the spaces.
  const win = await browser.windows.get(tab.windowId).catch(() => null);
  if (!win || win.type !== 'normal') return;

  // Reopened tab (Ctrl+Shift+T, session restore): it keeps its space.
  const saved = await browser.sessions.getTabValue(tab.id, 'space').catch(() => null);
  if (tabSpace.has(tab.id)) return notify(); // assigned in the meantime by newTab()
  let spaceId = getSpace(saved) ? saved : activeSpace(tab.windowId);
  if (!saved && tab.openerTabId && tabSpace.has(tab.openerTabId)) spaceId = tabSpace.get(tab.openerTabId);
  assign(tab.id, spaceId);

  // Ctrl+T in a space bound to a container: reopen the tab in that container.
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
      // Container deleted in the meantime: keep the tab as it is.
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
  // Tab of another space activated from elsewhere (tab search, link...): follow it.
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
  // Split view turned back into a normal tab (closed side): forget it.
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
  // splitViewId only exists in recent Firefox versions (split view).
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

// Change coming from the other PC through Firefox Sync.
browser.storage.onChanged.addListener(async (changes, area) => {
  await ready;
  if (area !== 'sync' || saving) return;
  await loadSpaces();
  for (const [windowId, spaceId] of activeByWindow) {
    if (!getSpace(spaceId)) await switchSpace(windowId, spaces[0].id);
  }
  notify();
});

// Import of an exported file (for example dropped in Nextcloud): replaces the spaces.
async function importSpaces(imported) {
  if (!Array.isArray(imported) || !imported.length) throw new Error('Invalid file');
  spaces = imported.map((s) => ({
    id: String(s.id || uid()),
    name: String(s.name || t('spaceFallbackName')),
    icon: s.icon === 'image' && validIconImage(s.iconImage) ? 'image' : String(s.icon && s.icon !== 'image' ? s.icon : 'lucide:sparkles'),
    iconImage: validIconImage(s.iconImage),
    background: ['none', 'color', 'gradient'].includes(s.background) ? s.background : null,
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
  // The tabs of the vanished spaces join the first space.
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

  // Active tab to the next / previous space (and follow it).
  if (command === 'move-tab-next' || command === 'move-tab-prev') {
    const [tab] = await browser.tabs.query({ windowId: win.id, active: true });
    if (!tab || tab.pinned) return undefined;
    const i = spaces.findIndex((s) => s.id === activeSpace(win.id));
    const target = spaces[(i + (command === 'move-tab-next' ? 1 : -1) + spaces.length) % spaces.length];
    assign(tab.id, target.id);
    setFav(tab.id, null);
    return switchSpace(win.id, target.id);
  }

  // Favorite n of the active space.
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

// --- Small windows (space editing, settings) ---------------------------------
// The compact sidebar is too narrow for a form: the same page is opened
// in a small window, in "edit" or "settings" mode.

function openPopup(query, height = 640, width = 460) {
  return browser.windows.create({
    url: `${SIDEBAR_PAGE}?${query}`,
    type: 'popup',
    width,
    height,
  });
}

// Dialogs (space editor, settings, archive, group, setup) open like quick search: an
// overlay injected in the active page when Arbalète may enter it (activeTab from a menu
// click, or the "all sites" permission), otherwise a popup window. The sidebar itself
// prefers the panel under the toolbar button for pages it cannot enter (see sidebar.js).
// The dialog page is web-accessible so the overlay can frame it: a token (valid one hour,
// also for the dialogs it switches to) tells it that Arbalète opened it, and not some
// web page that framed it on its own.
const dialogTokens = new Map(); // token -> expiry time

async function openDialog(windowId, query) {
  const tab = activeTabByWindow.get(windowId);
  if (tab && canInject(tab.url)) {
    const token = uid() + uid();
    dialogTokens.set(token, Date.now() + 3600e3);
    const url = `${SIDEBAR_PAGE}?${query}&win=${windowId}&overlay=1&token=${token}`;
    try {
      await browser.tabs.executeScript(tab.id, { code: `window.arbaleteOverlay = ${JSON.stringify({ kind: 'dialog', url })};` });
      await browser.tabs.executeScript(tab.id, { file: 'palette/overlay.js' });
      return;
    } catch (e) {
      dialogTokens.delete(token); // no access to this page: fall back to a window
    }
  }
  await openPopup(`${query}&win=${windowId}`, /^(edit|settings)=/.test(query) ? 760 : 560);
}

const editSpace = (windowId, spaceId) => openDialog(windowId, `edit=${encodeURIComponent(spaceId)}`);
const openSettings = (windowId) => openDialog(windowId, 'settings=1');
const openSetup = (windowId) => openDialog(windowId, 'setup=1');

// Menu items that open a dialog: when the overlay is impossible, the panel under the
// toolbar button is only allowed during the click itself, before any "await".
function dialogFromMenu(windowId, query) {
  const tab = activeTabByWindow.get(windowId);
  if (tab && canInject(tab.url)) return openDialog(windowId, query);
  browser.browserAction.setPopup({ popup: `${SIDEBAR_PAGE}?${query}&win=${windowId}&panel=1` });
  return browser.browserAction.openPopup().catch(() => openDialog(windowId, query));
}

// First install: offer right away to hide Firefox's own tabs.
browser.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  await ready;
  const win = await browser.windows.getLastFocused();
  openPopup(`setup=1&win=${win.id}`, 560);
});

// --- Per-site rules ----------------------------------------------------------
// Each space can list sites (space.sites, one domain per line): a tab that loads one
// of them joins the space (and its container if it has one). If it is the displayed
// tab, we follow it. The first space that claims the site wins.
// A site also covers its subdomains; "*" stands for any part of the address.

const sitePatterns = new Map(); // site -> RegExp
function siteMatches(hostname, site) {
  if (!site.includes('*')) return hostname === site || hostname.endsWith(`.${site}`);
  if (!sitePatterns.has(site)) {
    const body = site.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+');
    sitePatterns.set(site, new RegExp(`^(?:.+\\.)?${body}$`));
  }
  return sitePatterns.get(site).test(hostname);
}

function siteRuleSpace(url) {
  let hostname;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    hostname = u.hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
  return spaces.find((s) => (s.sites || []).some((d) => siteMatches(hostname, d))) || null;
}

const ruleMoves = new Set(); // tabs being reopened in a container

async function applySiteRule(tab) {
  if (tab.pinned || ruleMoves.has(tab.id)) return;
  const win = await browser.windows.get(tab.windowId).catch(() => null);
  if (!win || win.type !== 'normal') return;
  const space = siteRuleSpace(tab.url);
  if (!space) return;
  const needsContainer = space.cookieStoreId && tab.cookieStoreId !== space.cookieStoreId;
  if (tabSpace.get(tab.id) === space.id && !needsContainer) return;

  if (needsContainer) {
    // A container's cookies cannot be switched on the fly: reopen in the right one.
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

// --- Time-based switching ----------------------------------------------------
// space.schedule = { slots: [{ days: [1, 2, 3, 4, 5], from: '09:00', to: '12:00' }, …] },
// days numbered like Date.getDay() (0 = Sunday). A slot that ends before it starts runs
// overnight and belongs to the day it starts. Older versions stored a single slot as
// { days: 'all' | 'week' | 'weekend', from, to }: read by scheduleSlots().
// When a slot begins, all windows switch to its space, only once: the user can then
// switch spaces by hand without being brought back until the next slot.

const DAY_SETS = { all: [0, 1, 2, 3, 4, 5, 6], week: [1, 2, 3, 4, 5], weekend: [0, 6] };

function scheduleSlots(rule) {
  if (!rule || typeof rule !== 'object') return [];
  if (Array.isArray(rule.slots)) return rule.slots;
  return [{ days: DAY_SETS[rule.days] || DAY_SETS.all, from: rule.from, to: rule.to }];
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};

// The space and slot active at this date, or null. The first space in the list wins.
function scheduledSlot(date) {
  const day = date.getDay();
  const yesterday = (day + 6) % 7;
  const minutes = date.getHours() * 60 + date.getMinutes();
  for (const space of spaces) {
    const slots = scheduleSlots(space.schedule);
    for (let i = 0; i < slots.length; i++) {
      const { days, from: start, to: end } = slots[i];
      const from = toMinutes(start);
      const to = toMinutes(end);
      if (from === null || to === null || !Array.isArray(days)) continue;
      const inside = from <= to
        ? days.includes(day) && minutes >= from && minutes < to
        : (days.includes(day) && minutes >= from) || (days.includes(yesterday) && minutes < to);
      if (inside) return { space, key: `${space.id}:${i}` };
    }
  }
  return null;
}

let lastSlotKey;
async function checkSchedule() {
  const slot = scheduledSlot(new Date());
  const key = slot ? slot.key : null;
  if (lastSlotKey === undefined) {
    lastSlotKey = key; // at startup, do not disturb the restored space
    return;
  }
  if (key === lastSlotKey) return;
  lastSlotKey = key;
  if (!slot) return;
  for (const windowId of activeByWindow.keys()) {
    if (activeSpace(windowId) !== slot.space.id) await switchSpace(windowId, slot.space.id);
  }
}

// --- Theme in the space's colors (settings option) ---------------------------

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

// --- Statistics: time spent per space ----------------------------------------
// Every minute during which a Firefox window has focus, one minute is counted for its
// active space. Kept 14 days, on this PC only.

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

// A clock ticking every minute for the schedules and the statistics.
ready.then(() => {
  checkSchedule().catch(() => {});
  applyThemeEverywhere().catch(() => {});
  setInterval(() => {
    checkSchedule().catch(() => {});
    countMinute().catch(() => {});
  }, 60e3);
});

// --- Archive and automatic cleanup (Arc-style) -------------------------------
// Each space can store its inactive tabs on its own after a delay (archiveAfter,
// in hours, 0 = never). They go into the space's archive (storage.local, specific to
// this PC), from where they are reopened in one click. The archive is purged after 30 days.
// Never archived: active tab, pinned tabs, favorites, tabs playing sound, selected
// tabs or tabs in a group, internal pages.

const ARCHIVE_DAYS = 30;
const ARCHIVE_MAX_PER_SPACE = 300;
const ARCHIVE_DELAYS = [0, 12, 24, 168]; // delays offered (in hours) in "Edit space"

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

// Stores tabs in their space's archive, then closes them.
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
  if (!old.length) await writeArchive(await readArchive()); // purge of old entries
}

// Every 10 minutes, and one minute after startup.
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

const openArchive = (windowId) => openDialog(windowId, 'archive=1');

// --- Context menus -----------------------------------------------------------
// Right click in the sidebar: a real Firefox menu is shown (menus.overrideContext),
// which can overflow the sidebar. But on a tab, Firefox only puts the extensions'
// entries in it, not its own: Arbalète therefore recreates Firefox's tab menu
// (everything an API allows; not split view nor sending to a device).
// These "native" entries are only shown from the sidebar (viewType sidebar),
// so as not to duplicate the real menu when the native tabs are visible.

let lastMenuTarget = null; // { kind: 'fav' | 'space' | 'group' | 'global', windowId, spaceId, favId, tabId, groupId }

// menu id -> translation key
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

// Tab menu, in the order of Firefox's. null = separator.
// Entries marked native are only shown from the Arbalète sidebar.
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

// Tabs targeted by the menu: the multi-selection if the clicked tab is part of it.
async function menuTabs(tab) {
  if (!tab.highlighted) return [tab];
  const selected = await browser.tabs.query({ windowId: tab.windowId, highlighted: true });
  return selected.length > 1 ? selected : [tab];
}

// Tabs of this tab's space, in sidebar order (excluding pinned).
async function spaceTabs(tab) {
  const spaceId = tabSpace.get(tab.id);
  return (await browser.tabs.query({ windowId: tab.windowId }))
    .filter((x) => !x.pinned && tabSpace.get(x.id) === spaceId);
}

// Submenus computed on opening: window groups, containers.
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
      // containers disabled
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
    // (t is the menu target here: translate without going through t())
    await browser.menus.update('arb-fav-share', { title: browser.i18n.getMessage(t.shared ? 'menuFavUnshare' : 'menuFavShare') }).catch(() => {});
  }
  browser.menus.refresh();
});

// Actions of the recreated tab menu. targets = targeted tabs (multi-selection included).
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
      // Like Firefox: create the group, then offer to name it.
      const groupId = await browser.tabs.group({ tabIds: ids });
      return openDialog(tab.windowId, `group=${groupId}`);
    }
    case 'addgroup': return browser.tabs.group({ groupId: Number(arg), tabIds: ids });
    case 'ungroup': return browser.tabs.ungroup(ids);
    case 'split': return openSplit(tab, targets);
    case 'reload': return Promise.all(ids.map((x) => browser.tabs.reload(x)));
    case 'mute': return Promise.all(ids.map((x) => browser.tabs.update(x, { muted: !tab.mutedInfo.muted })));
    case 'pin': return Promise.all(ids.map((x) => browser.tabs.update(x, { pinned: !tab.pinned })));
    case 'discard':
      // Firefox does not unload the displayed tab: first switch to another tab of the space.
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

// --- Home-made split view (split/split.html page with two frames) ------------
// Firefox's native split view is not accessible to extensions. Here: an extension tab
// showing two sites. It needs the optional "all sites" permission (requested on first
// use by the page itself) in order to:
//  - remove X-Frame-Options and frame-ancestors, which forbid sites from being
//    displayed in a frame, only for this page's frames;
//  - follow the frames' navigations (displayed address, "Separate").

async function openSplit(tab, targets) {
  // Internal pages (new tab, about:...) cannot be displayed in a frame: their side
  // opens empty, with the choice of a tab or an address.
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

// An extension page does not send a Referer to its frames. Some sites require one
// (YouTube's embedded player otherwise shows "error 153"): we announce the Arbalète
// repository as the embedding site (YouTube refuses youtube.com itself).
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

// Firefox closes all of an extension's tabs when it is reloaded or updated.
// So we keep the list of open split views (storage.local) in order to
// reopen them afterwards. Each view has a "sid" identifier in its address.
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

// Tab closed: wait a little, because if it is the extension that stops (update),
// this delay never completes and the view stays remembered.
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

// --- Quick search ------------------------------------------------------------
// Alt+K: centered overlay injected in the active tab (activeTab permission, granted by
// the shortcut). Arbalète split view: the page displays the overlay itself.
// Pages where Firefox forbids every extension (about:, Mozilla sites...): panel under
// the Arbalète icon. browserAction.openPopup() is only allowed during the user's
// gesture, before any "await": the decision is therefore made on a cache
// (active window and address of its active tab) kept continuously up to date.

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

// Called during the user's gesture: never any await before openPopup().
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
  browser.browserAction.setPopup({ popup: null }); // back to quick search after a dialog panel
  browser.browserAction.openPopup().catch(() => {});
}

// Separate listener with no await: the shortcut must remain a "gesture" for Firefox.
browser.commands.onCommand.addListener((command) => {
  if (command === 'open-palette' && focusedWindowId !== null) openPalette(focusedWindowId);
});

// If the displayed tab is among those about to be unloaded or archived, first activate
// the most recent of the other tabs of the space (otherwise Firefox would pick a
// neighboring tab, maybe from another space), or a new tab.
async function leaveTabs(tab, ids) {
  const [active] = await browser.tabs.query({ windowId: tab.windowId, active: true });
  if (!active || !ids.includes(active.id)) return;
  const others = (await spaceTabs(active)).filter((x) => !ids.includes(x.id))
    .sort((a, b) => b.lastAccessed - a.lastAccessed);
  if (others.length) await browser.tabs.update(others[0].id, { active: true });
  else await newTab(tab.windowId, tabSpace.get(active.id) || activeSpace(tab.windowId));
}

// Multi-selection: Firefox's (the "highlighted" tabs). The first one in the
// list must be the active tab, otherwise Firefox activates another one.
async function highlightTabs(windowId, tabIds) {
  const tabs = await browser.tabs.query({ windowId });
  const indexes = tabIds.map((id) => tabs.find((x) => x.id === id)).filter(Boolean).map((x) => x.index);
  if (indexes.length) await browser.tabs.highlight({ windowId, tabs: indexes, populate: false });
}

browser.menus.onClicked.addListener(async (info, tab) => {
  // Dialogs first, before any "await": the panel fallback needs the click itself.
  const id = String(info.menuItemId);
  const target = lastMenuTarget;
  if (target && id === 'arb-space-edit') return dialogFromMenu(target.windowId, `edit=${encodeURIComponent(target.spaceId)}`);
  if (target && id === 'arb-new-space') return dialogFromMenu(target.windowId, 'edit=new');
  if (target && id === 'arb-settings') return dialogFromMenu(target.windowId, 'settings=1');
  if (target && id === 'arb-group-edit') return dialogFromMenu(target.windowId, `group=${target.groupId}`);
  await ready;
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
    case 'arb-space-left':
    case 'arb-space-right': {
      const ids = spaces.map((s) => s.id);
      const [moved] = ids.splice(index, 1);
      ids.splice(index + (id === 'arb-space-left' ? -1 : 1), 0, moved);
      return reorderSpaces(ids);
    }
    case 'arb-clear': return handlers.clearSpace({ windowId: t.windowId, spaceId: activeSpace(t.windowId) });
  }
  return undefined;
});

// Actions of the right click on a tab group (Firefox does not lend its group menu
// to extensions, so the essentials are reproduced).
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

// --- Sidebar messages --------------------------------------------------------

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
  createSpace: (m) => createSpace(m.windowId, m.space),
  saveSpace: (m) => upsertSpace(m.space),
  deleteSpace: (m) => deleteSpace(m.spaceId),
  reorderSpaces: (m) => reorderSpaces(m.ids),
  editSpace: (m) => editSpace(m.windowId, m.spaceId).then(() => undefined),
  openSettings: (m) => openSettings(m.windowId).then(() => undefined),
  openSetup: (m) => openSetup(m.windowId).then(() => undefined),
  openDialog: (m) => openDialog(m.windowId, m.query),
  // Dialog pages framed in a web page only get storage and messaging: everything else
  // goes through here.
  claimDialog: (m) => (dialogTokens.get(m.token) || 0) > Date.now(),
  createContainer: (m) => browser.contextualIdentities.create({ name: m.name, color: 'purple', icon: 'circle' })
    .then((c) => c.cookieStoreId),
  getGroup: (m) => browser.tabGroups.get(m.groupId).catch(() => null),
  updateGroup: (m) => browser.tabGroups.update(m.groupId, m.changes).then(() => undefined),
  platform: () => browser.runtime.getPlatformInfo().then((p) => p.os),
  hasPermission: (m) => browser.permissions.contains(m.permissions),
  copyText: (m) => navigator.clipboard.writeText(m.text),
  removePermission: (m) => browser.permissions.remove(m.permissions),
  // A window where the dialog keeps every API (file picker, permission requests).
  openWindow: (m) => openPopup(`${m.query}&win=${m.windowId}`, m.small ? 290 : 760, m.small ? 420 : 460).then(() => undefined),
  setMenuTarget: (m) => { lastMenuTarget = m.target; },
  enableSplit: () => enableSplitSupport(),
  openPalette: (m) => openPalette(m.windowId),
  // Quick search actions that require rights missing from its frame.
  reopenClosed: () => browser.sessions.restore().then(() => undefined),
  openShortcuts: () => (browser.commands.openShortcutSettings ? browser.commands.openShortcutSettings() : undefined),
  webSearch: (m) => browser.search.query({ text: m.text, disposition: 'NEW_TAB' }),
  // Suggestions from the engine chosen in the settings (OpenSearch format, like Firefox).
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
  // Internal navigation of a frame (frame.js): relayed to the split view page.
  splitFrameChanged: (m, sender) => {
    if (!sender.tab || !splitTabs.has(sender.tab.id) && !(sender.tab.url || '').startsWith(SPLIT_PAGE)) return undefined;
    return browser.runtime.sendMessage({ type: 'splitFrame', tabId: sender.tab.id, frameId: sender.frameId, url: m.url, title: m.title })
      .catch(() => {});
  },
  splitState: (m, sender) => rememberSplit(sender.tab.id, m.sid, m.url),
  highlight: (m) => highlightTabs(m.windowId, m.tabIds),
  // Tab menu actions, from the quick search.
  tabAction: async (m) => tabAction('arb-tab-' + m.action, await browser.tabs.get(m.tabId)),
  toggleMute: (m) => browser.tabs.update(m.tabId, { muted: m.muted }).then(() => undefined),
  toggleGroup: (m) => browser.tabGroups.update(m.groupId, { collapsed: m.collapsed }).then(() => undefined),
  exportSpaces: () => spaces.map(({ cookieStoreId, ...rest }) => rest),
  importSpaces: (m) => importSpaces(m.spaces),
  clearSpace: async (m) => {
    // "Clean up": stores the space's tabs in the archive (except favorites and
    // pinned), internal pages are simply closed.
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
