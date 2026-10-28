'use strict';

// Arbalète sidebar: shows the active space of ITS window. All the logic (hiding
// tabs, sync, menus) is in background.js; here we only display the state and send
// messages.
// The same page also serves as a small window: ?edit=<space>&win=<window> to edit
// a space, ?settings=1&win=<window> for the settings.

const $ = (sel) => document.querySelector(sel);
const t = (key, ...subs) => browser.i18n.getMessage(key, subs.map(String)) || key;
const send = (type, data = {}) => browser.runtime.sendMessage({ type, windowId, ...data });

const params = new URLSearchParams(location.search);
const mode = ['edit', 'group', 'settings', 'setup', 'archive', 'grant', 'share', 'welcome'].find((m) => params.has(m)) || 'sidebar';
// Where a dialog is shown: overlay (frame in the page, see palette/overlay.js), panel
// (under the toolbar button) or window (popup window). In the overlay, Firefox only gives
// storage and messaging: anything else goes through the background script.
const frame = params.has('overlay') ? 'overlay' : params.has('panel') ? 'panel' : 'window';

function closeDialog() {
  if (frame === 'overlay') window.parent.postMessage({ from: 'arbalete-palette', type: 'arbalete-palette-close' }, '*');
  else window.close();
}

// Switch the dialog to another one in place (settings -> new space, setup…).
function goToDialog(query) {
  const keep = ['win', 'overlay', 'panel', 'token'].filter((k) => params.has(k)).map((k) => `${k}=${params.get(k)}`);
  location.replace(`?${query}&${keep.join('&')}`);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const SPRITE = '../icons/lucide.svg';
const GROUP_COLORS = {
  grey: '#8f8f9d', blue: '#3d8bd9', red: '#e5484d', yellow: '#d6a92b', green: '#3fa37b',
  pink: '#d9577a', purple: '#9b6cf2', cyan: '#2fb5c9', orange: '#e4834b',
};

let windowId = null;
let state = null;
let previousSpaceIndex = -1;

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

function icon(name, className = 'ic') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `${SPRITE}#${name}`);
  svg.append(use);
  return svg;
}

// Space icon: "lucide:<name>", "image" (imported, space.iconImage), or an old emoji (0.1.x).
function spaceIcon(space, className = 'ic') {
  const value = space.icon || '';
  if (value === 'image' && space.iconImage) return el('img', { class: `${className} space-img`, src: space.iconImage, alt: '' });
  if (value.startsWith('lucide:')) return icon(value.slice(7), className);
  return el('span', { class: 'emoji' }, value || '•');
}

function favicon(url, label) {
  if (url && !url.startsWith('chrome://')) {
    const img = el('img', { class: 'favicon', src: url, alt: '' });
    img.addEventListener('error', () => img.replaceWith(defaultFavicon()));
    return img;
  }
  return defaultFavicon();
}

// Page without a favicon (new tab, internal page): gray globe, like Firefox.
function defaultFavicon() {
  return icon('globe', 'ic favicon default');
}

function currentSpace() {
  return state.spaces.find((s) => s.id === state.activeSpaceId) || state.spaces[0];
}

// --- Sidebar rendering -------------------------------------------------------

function render() {
  const space = currentSpace();
  const index = state.spaces.indexOf(space);
  if (mode === 'edit') return; // the editor previews its own colors
  previewBackground(space.color, space.color2 || space.color, spaceBackground(space));
  if (mode !== 'sidebar') return;

  renderFavorites(space);
  renderTabs(space);
  renderSpaces(space);

  if (previousSpaceIndex !== -1 && previousSpaceIndex !== index) {
    const list = $('#tabs');
    list.classList.remove('slide-left', 'slide-right');
    void list.offsetWidth; // restarts the animation
    list.classList.add(index > previousSpaceIndex ? 'slide-left' : 'slide-right');
  }
  previousSpaceIndex = index;
}

function renderFavorites(space) {
  // Favorites shared by all spaces first (dashed border), then those of the space.
  const all = [...(state.shared || []).map((fav) => ({ fav, shared: true })), ...space.favorites.map((fav) => ({ fav, shared: false }))];
  $('#favorites').replaceChildren(
    ...all.map(({ fav, shared }) => {
      const tab = state.tabs.find((t) => t.favId === fav.id && t.spaceId === space.id);
      const classes = ['fav', shared && 'shared', tab && 'open', tab && tab.active && 'active'].filter(Boolean).join(' ');
      const node = el('button', {
        class: classes,
        title: fav.title,
        'aria-label': fav.title,
        onclick: () => send('openFavorite', { spaceId: space.id, favId: fav.id }),
        onauxclick: (e) => { if (e.button === 1 && tab) send('closeTab', { tabId: tab.id }); },
      }, [favicon(tab ? tab.favIconUrl || fav.favIconUrl : fav.favIconUrl, fav.title), el('span', { class: 'label' }, fav.title)]);
      node.menuTarget = { kind: 'fav', spaceId: space.id, favId: fav.id, tabId: tab ? tab.id : null, shared };
      return node;
    })
  );
}

function renderTabs(space) {
  const pinned = state.tabs.filter((t) => t.pinned);
  const own = state.tabs.filter((t) => !t.pinned && t.spaceId === space.id && !t.favId);
  const groups = new Map(state.groups.map((g) => [g.id, g]));
  const rows = pinned.map((t) => tabRow(t));
  if (pinned.length && own.length) rows.push(el('div', { class: 'separator' }));

  let currentGroup = null;
  for (let i = 0; i < own.length; i++) {
    const tab = own[i];
    const group = groups.get(tab.groupId) || null;
    if (group && group !== currentGroup) rows.push(groupRow(group));
    currentGroup = group;
    if (group && group.collapsed && !tab.active) continue;
    // Firefox split view: the two tabs side by side, on a single line.
    const next = own[i + 1];
    if (tab.splitViewId !== -1 && next && next.splitViewId === tab.splitViewId) {
      rows.push(el('div', { class: 'split', role: 'group' }, [tabRow(tab, group), tabRow(next, group)]));
      i++;
      continue;
    }
    rows.push(tabRow(tab, group));
  }
  if (!own.length) rows.push(el('div', { class: 'empty' }, t('emptySpace')));

  const list = $('#tabs');
  const focused = list.contains(document.activeElement) ? document.activeElement.closest('[data-key]') : null;
  const focusedIndex = focused ? [...list.querySelectorAll('[data-key]')].indexOf(focused) : -1;
  list.setAttribute('aria-label', t('tabList', space.name));
  list.replaceChildren(...rows);

  // Keyboard navigation: a single element of the list receives Tab ("roving tabindex").
  const items = [...list.querySelectorAll('[data-key]')];
  const restored = focused && items.find((r) => r.dataset.key === focused.dataset.key);
  const current = restored || (focused && items[Math.min(focusedIndex, items.length - 1)])
    || items.find((r) => r.classList.contains('active')) || items[0];
  if (current) {
    current.tabIndex = 0;
    if (focused) current.focus();
  }
}

$('#tabs').addEventListener('keydown', (e) => {
  const items = [...$('#tabs').querySelectorAll('[data-key]')];
  const i = items.indexOf(document.activeElement);
  if (i === -1) return;
  const row = items[i];
  const focusRow = (r) => {
    if (!r) return;
    for (const x of items) x.tabIndex = -1;
    r.tabIndex = 0;
    r.focus();
  };
  switch (e.key) {
    case 'ArrowDown': focusRow(items[i + 1]); break;
    case 'ArrowUp': focusRow(items[i - 1]); break;
    case 'Home': focusRow(items[0]); break;
    case 'End': focusRow(items[items.length - 1]); break;
    case 'Enter':
    case ' ': row.click(); break;
    case 'Delete':
      if (row.menuTarget.kind === 'tab') send('closeTab', { tabId: row.menuTarget.tabId });
      break;
    case 'Escape': {
      const active = state.tabs.find((x) => x.active);
      if (active) send('highlight', { tabIds: [active.id] });
      break;
    }
    default: return;
  }
  e.preventDefault();
});

function groupRow(group) {
  const color = GROUP_COLORS[group.color] || GROUP_COLORS.grey;
  const title = group.title || t('group');
  const row = el('div', {
    class: group.collapsed ? 'group collapsed' : 'group',
    role: 'listitem',
    tabIndex: -1,
    'aria-expanded': String(!group.collapsed),
    'aria-label': title,
    title: t(group.collapsed ? 'groupExpand' : 'groupCollapse', title),
    onclick: () => send('toggleGroup', { groupId: group.id, collapsed: !group.collapsed }),
  }, [
    icon('chevron-down', 'ic chevron'),
    el('span', { class: 'group-title' }, title),
  ]);
  row.style.setProperty('--group', color);
  row.menuTarget = { kind: 'group', groupId: group.id };
  row.dataset.key = 'group:' + group.id;
  return row;
}

// Multi-selection: it is Firefox's ("highlighted" tabs), shared with
// its own shortcuts and with the Arbalète right click.
const isMultiSelected = (tab) => tab.highlighted && !tab.active && state.tabs.some((x) => x.active && x.highlighted);

function ownTabIds() {
  const space = currentSpace();
  return state.tabs.filter((x) => !x.pinned && x.spaceId === space.id && !x.favId).map((x) => x.id);
}

function onTabClick(e, tab) {
  const active = state.tabs.find((x) => x.active);
  const selected = state.tabs.filter((x) => x.highlighted && !x.active).map((x) => x.id);
  if ((e.ctrlKey || e.metaKey) && active && !tab.active) {
    const others = selected.includes(tab.id) ? selected.filter((id) => id !== tab.id) : [...selected, tab.id];
    return send('highlight', { tabIds: [active.id, ...others] });
  }
  if (e.shiftKey && active && !tab.active) {
    const order = ownTabIds();
    const from = order.indexOf(active.id);
    const to = order.indexOf(tab.id);
    if (from !== -1 && to !== -1) {
      const range = order.slice(Math.min(from, to), Math.max(from, to) + 1).filter((id) => id !== active.id);
      return send('highlight', { tabIds: [active.id, ...range] });
    }
  }
  // Simple click: activates the tab and clears the selection.
  if (selected.length) return send('highlight', { tabIds: [tab.id] });
  return send('activateTab', { tabId: tab.id });
}

// Notification badge: the number that sites put in their title,
// "(3) Mastodon" or "Inbox (12) - Gmail". 1 to 3 digits only,
// so as not to mistake a year "(2026)" for messages.
function unreadCount(title) {
  const match = /\((\d{1,3})\+?\)/.exec(title || '');
  return match ? Number(match[1]) : 0;
}
const formatCount = (n) => (n > 99 ? '99+' : String(n));

function tabRow(tab, group) {
  const classes = ['tab', tab.active && 'active', isMultiSelected(tab) && 'selected', tab.discarded && 'discarded',
    tab.status === 'loading' && 'loading', group && 'in-group']
    .filter(Boolean).join(' ');
  const row = el('div', {
    class: classes,
    title: `${tab.title}\n${tab.url}`,
    role: 'listitem',
    tabIndex: -1,
    'aria-label': tab.title || tab.url,
    draggable: true,
    onclick: (e) => onTabClick(e, tab),
    onauxclick: (e) => { if (e.button === 1) send('closeTab', { tabId: tab.id }); },
    ondragstart: (e) => {
      e.dataTransfer.setData('application/x-arbalete-tab', String(tab.id));
      e.dataTransfer.setData('text/uri-list', tab.url);
      e.dataTransfer.effectAllowed = 'move';
    },
    ondragover: (e) => {
      if (!isTabDrag(e)) return;
      e.preventDefault();
      row.classList.add('drop-before');
    },
    ondragleave: () => row.classList.remove('drop-before'),
    ondrop: (e) => {
      row.classList.remove('drop-before');
      const tabId = draggedTab(e);
      if (tabId == null || tabId === tab.id) return;
      e.preventDefault();
      const dragged = state.tabs.find((t) => t.id === tabId);
      const index = dragged && dragged.index < tab.index ? tab.index - 1 : tab.index;
      send('reorderTab', { tabId, index });
    },
  }, [
    el('span', { class: 'fav-wrap' }, [
      favicon(tab.favIconUrl, tab.title),
      unreadCount(tab.title) ? el('span', { class: 'count', 'aria-label': t('unreadCount', unreadCount(tab.title)) }, formatCount(unreadCount(tab.title))) : null,
    ]),
    el('span', { class: 'title' }, tab.title || tab.url),
    tab.audible || tab.muted
      ? el('button', {
        class: tab.muted ? 'audio muted' : 'audio',
        title: t(tab.muted ? 'unmute' : 'mute'),
        'aria-label': t(tab.muted ? 'unmute' : 'mute'),
        tabIndex: -1,
        onclick: (e) => { e.stopPropagation(); send('toggleMute', { tabId: tab.id, muted: !tab.muted }); },
      }, icon(tab.muted ? 'volume-x' : 'volume-2'))
      : null,
    tab.pinned ? icon('pin', 'ic badge') : null,
    el('button', {
      class: 'close',
      title: t('closeTab'),
      'aria-label': t('closeTab'),
      tabIndex: -1,
      onclick: (e) => { e.stopPropagation(); send('closeTab', { tabId: tab.id }); },
    }, icon('x')),
  ]);
  if (group) row.style.setProperty('--group', GROUP_COLORS[group.color] || GROUP_COLORS.grey);
  row.menuTarget = { kind: 'tab', tabId: tab.id };
  row.dataset.key = 'tab:' + tab.id;
  if (tab.active) row.setAttribute('aria-current', 'page');
  if (isMultiSelected(tab)) row.setAttribute('aria-selected', 'true');
  return row;
}

function renderSpaces(space) {
  $('#spaces').replaceChildren(
    ...state.spaces.map((s, i) => {
      const dot = el('button', {
        class: s.id === space.id ? 'space-dot active' : 'space-dot',
        title: t('spaceButton', s.name, i + 1),
        'aria-label': s.name,
        'aria-pressed': String(s.id === space.id),
        draggable: true,
        onclick: () => send('switchSpace', { spaceId: s.id }),
        ondblclick: () => openDialog(`edit=${encodeURIComponent(s.id)}`),
        ondragstart: (e) => e.dataTransfer.setData('application/x-arbalete-space', s.id),
        ondragover: (e) => {
          if (!isTabDrag(e) && !e.dataTransfer.types.includes('application/x-arbalete-space')) return;
          e.preventDefault();
          dot.classList.add('drop-target');
        },
        ondragleave: () => dot.classList.remove('drop-target'),
        ondrop: (e) => {
          dot.classList.remove('drop-target');
          e.preventDefault();
          const tabId = draggedTab(e);
          if (tabId != null) return send('moveTab', { tabId, spaceId: s.id });
          const movedId = e.dataTransfer.getData('application/x-arbalete-space');
          if (!movedId || movedId === s.id) return;
          const ids = state.spaces.map((x) => x.id).filter((id) => id !== movedId);
          ids.splice(ids.indexOf(s.id) + (i > state.spaces.findIndex((x) => x.id === movedId) ? 1 : 0), 0, movedId);
          send('reorderSpaces', { ids });
        },
      }, [spaceIcon(s), el('span', { class: 'label' }, s.name)]);
      dot.style.setProperty('--dot', s.color);
      dot.menuTarget = { kind: 'space', spaceId: s.id };
      return dot;
    }),
    el('button', {
      class: 'space-dot add',
      title: t('newSpace'),
      'aria-label': t('newSpace'),
      onclick: () => openDialog('edit=new'),
    }, [icon('plus'), el('span', { class: 'label' }, t('newSpace'))])
  );
}

// Middle click closes a tab or a favorite's tab (auxclick handlers): Firefox's autoscroll
// starts on the middle button press and would swallow the click, so it is blocked here.
document.addEventListener('mousedown', (e) => {
  if (e.button === 1 && mode === 'sidebar') e.preventDefault();
});

// --- Drag and drop -----------------------------------------------------------

const isTabDrag = (e) => e.dataTransfer.types.includes('application/x-arbalete-tab');
function draggedTab(e) {
  const raw = e.dataTransfer.getData('application/x-arbalete-tab');
  return raw ? Number(raw) : null;
}

const favBox = $('#favorites');
// Accepts a tab from the sidebar, or a link dragged from a web page.
const isLinkDrag = (e) => e.dataTransfer.types.includes('text/x-moz-url') || e.dataTransfer.types.includes('text/uri-list');
favBox.addEventListener('dragover', (e) => {
  if (!isTabDrag(e) && !isLinkDrag(e)) return;
  e.preventDefault();
  favBox.classList.add('drop-target');
});
favBox.addEventListener('dragleave', () => favBox.classList.remove('drop-target'));
favBox.addEventListener('drop', (e) => {
  favBox.classList.remove('drop-target');
  const tabId = draggedTab(e);
  if (tabId != null) {
    e.preventDefault();
    send('addFavorite', { tabId });
    return;
  }
  // text/x-moz-url: "address" then "title" on two lines
  const [url, title] = (e.dataTransfer.getData('text/x-moz-url') || e.dataTransfer.getData('text/uri-list')).split(/\r?\n/);
  if (!url) return;
  e.preventDefault();
  send('addFavoriteUrl', { url: url.trim(), title: (title || '').trim() });
});

// --- Right click: real Firefox menu, which can extend beyond the sidebar -----

document.addEventListener('contextmenu', (e) => {
  if (mode !== 'sidebar') return;
  let node = e.target;
  while (node && !node.menuTarget) node = node.parentElement;
  const target = node ? node.menuTarget : { kind: 'global' };
  if (target.kind === 'tab') {
    browser.menus.overrideContext({ context: 'tab', tabId: target.tabId });
    return;
  }
  browser.menus.overrideContext({ showDefaults: false });
  send('setMenuTarget', { target: { ...target, windowId } });
});

// --- Sidebar footer ----------------------------------------------------------

function initSidebar() {
  $('#new-tab').append(icon('plus'), el('span', { class: 'label' }, t('newTab')));
  $('#new-tab').addEventListener('click', () => send('newTab'));
  const label = (key) => el('span', { class: 'label' }, t(key));
  $('#settings-button').append(icon('settings'), label('toolSettings'));
  $('#search-button').append(icon('search'), label('toolSearch'));
  $('#archive-button').append(icon('archive'), label('toolArchive'));
  $('#archive-button').addEventListener('click', () => openDialog('archive=1'));
  $('#search-button').addEventListener('click', openPalette);
  $('#settings-button').addEventListener('click', () => openDialog('settings=1'));

  // Expand / collapse button (like the "Collapse" of many web apps): visible when widening on
  // hover is enabled (or when the sidebar was left expanded).
  const pin = $('#pin-button');
  let pinned = false;
  const updatePin = async () => {
    const s = await browser.storage.local.get(['expandOnHover', 'pinnedOpen']);
    pinned = !!s.pinnedOpen;
    pin.hidden = !s.expandOnHover && !pinned;
    pin.title = t(pinned ? 'pinCollapse' : 'pinExpand');
    pin.replaceChildren(icon(pinned ? 'panel-left-close' : 'panel-left-open'), el('span', { class: 'label' }, pin.title));
    pin.setAttribute('aria-label', pin.title);
    pin.setAttribute('aria-pressed', String(pinned));
  };
  pin.addEventListener('click', () => browser.storage.local.set({ pinnedOpen: !pinned }));
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.expandOnHover || changes.pinnedOpen)) updatePin();
  });
  updatePin();

  // Wide sidebar = userChrome.css not installed yet: offer to do it.
  browser.storage.local.get(['setupDone', 'setupDismissed', 'pinnedOpen']).then((s) => {
    if (s.setupDone || s.setupDismissed || s.pinnedOpen || window.innerWidth <= 120) return;
    $('#setup-banner').hidden = false;
  });
  $('#banner-setup').addEventListener('click', () => {
    $('#setup-banner').hidden = true;
    openDialog('setup=1');
  });
  $('#banner-later').addEventListener('click', () => {
    $('#setup-banner').hidden = true;
    browser.storage.local.set({ setupDismissed: true });
  });

  // Wheel: horizontal drag (or Shift+wheel) switches space, like in Arc.
  let accumulator = 0;
  let locked = false;
  document.addEventListener('wheel', (e) => {
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const overSpaces = $('#spaces').contains(e.target);
    const delta = horizontal ? e.deltaX : overSpaces ? e.deltaY : 0;
    if (!delta || locked) return;
    e.preventDefault();
    accumulator += delta;
    if (Math.abs(accumulator) < 40) return;
    send('switchRelative', { delta: Math.sign(accumulator) });
    accumulator = 0;
    locked = true;
    setTimeout(() => { locked = false; }, 350);
  }, { passive: false });
}

// Magnifier: overlay in the page if Arbalète can enter it (site access granted for the
// split view), otherwise panel under the Arbalète icon. openPopup() must be called
// during the click, hence the immediate decision on the already known state.
// The permission is checked again on every press of a mouse button: the answer is known
// before the click (or double click) that needs it, even when permissions.onAdded does not
// reach the sidebar (seen with a permission granted from another window).
let canReachSites = false;
if (mode === 'sidebar') {
  const checkSites = () => browser.permissions.contains({ origins: ['<all_urls>'] })
    .then((granted) => { canReachSites = granted; }, () => {});
  checkSites();
  browser.permissions.onAdded.addListener(checkSites);
  browser.permissions.onRemoved.addListener(checkSites);
  document.addEventListener('pointerdown', checkSites, true);
  window.addEventListener('focus', checkSites);
}
const SPLIT_URL = browser.runtime.getURL('split/split.html');

// The active tab is followed live: the full state arrives a little later, and a double
// click on another space switches tabs between its two clicks.
let activeTabId = null;
if (mode === 'sidebar') {
  browser.tabs.onActivated.addListener((info) => { if (info.windowId === windowId) activeTabId = info.tabId; });
}

function activeTab() {
  return (activeTabId !== null && state.tabs.find((x) => x.id === activeTabId)) || state.tabs.find((x) => x.active);
}

function canOverlay() {
  const active = activeTab();
  const url = active ? active.url : '';
  const web = /^(https?|file):/.test(url) && !/^https?:\/\/([\w-]+\.)*(mozilla\.org|firefox\.com|mozilla\.net)\//.test(url);
  return web && canReachSites;
}

function openPalette() {
  const active = activeTab();
  if (active && active.url.startsWith(SPLIT_URL)) return send('openPalette');
  if (canOverlay()) return send('openPalette');
  browser.browserAction.setPopup({ popup: null });
  return browser.browserAction.openPopup();
}

// Dialogs follow the same rule: overlay in the page when possible, otherwise the panel
// under the toolbar button (or a popup window if Firefox refuses the panel).
function openDialog(query) {
  if (canOverlay()) return send('openDialog', { query });
  // Absolute address: a relative one would be resolved against this page (sidebar/).
  browser.browserAction.setPopup({ popup: browser.runtime.getURL(`sidebar/sidebar.html?${query}&win=${windowId}&panel=1`) });
  return browser.browserAction.openPopup().catch(() => send('openDialog', { query }));
}

let toastTimer = null;
function toast(text) {
  const box = $('#toast');
  box.textContent = text;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 1800);
}

// --- "Edit space" window -----------------------------------------------------

// French search: a few common words mapped to Lucide's English keywords.
const FR_WORDS = {
  maison: 'house home', accueil: 'house home', perso: 'user house', travail: 'briefcase work', boulot: 'briefcase work',
  bureau: 'briefcase building office', musique: 'music', son: 'music volume audio', argent: 'money wallet coins euro',
  banque: 'landmark bank wallet', compta: 'calculator receipt', facture: 'receipt file', jeu: 'gamepad game', jeux: 'gamepad game',
  film: 'film clapperboard', cinema: 'film clapperboard', video: 'video youtube', photo: 'camera image', image: 'image',
  livre: 'book', lecture: 'book', ecole: 'school graduation', etude: 'graduation book', voyage: 'plane luggage map',
  carte: 'map', courses: 'shopping cart', achat: 'shopping cart bag', sante: 'heart stethoscope pill', sport: 'dumbbell trophy bike',
  velo: 'bike', cuisine: 'chef utensils', recette: 'utensils chef', courrier: 'mail', mail: 'mail', calendrier: 'calendar',
  agenda: 'calendar', etoile: 'star', coeur: 'heart', chat: 'cat', chien: 'dog', animal: 'paw', nature: 'leaf tree flower',
  arbre: 'tree', fleur: 'flower', soleil: 'sun', lune: 'moon', meteo: 'cloud sun', fete: 'party', billet: 'ticket',
  billetterie: 'ticket', spectacle: 'drama ticket theater', theatre: 'drama theater', concert: 'music guitar mic', guitare: 'guitar',
  micro: 'mic', reseau: 'share network', social: 'users share', equipe: 'users', personne: 'user', famille: 'users baby',
  outil: 'wrench hammer', reglage: 'settings', dossier: 'folder', fichier: 'file', ecrire: 'pen pencil', dessin: 'palette brush',
  couleur: 'palette', securite: 'shield lock', cle: 'key', code: 'code terminal', dev: 'code terminal git', serveur: 'server',
  nuage: 'cloud', telephone: 'phone smartphone', ordinateur: 'laptop monitor', recherche: 'search', idee: 'lightbulb',
  projet: 'folder kanban rocket', fusee: 'rocket', voiture: 'car', train: 'train', avion: 'plane',
  plage: 'umbrella waves', montagne: 'mountain', cafe: 'coffee', biere: 'beer', vin: 'wine', pizza: 'pizza', cadeau: 'gift',
  association: 'handshake users', asso: 'handshake users', culture: 'drama palette book', radio: 'radio', podcast: 'podcast mic',
  info: 'newspaper info', actualite: 'newspaper', journal: 'newspaper', ia: 'bot sparkles brain', robot: 'bot',
};

let iconIndex = null;
let selectedIcon = { name: 'sparkles' };

const normalize = (text) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

async function loadIconIndex() {
  if (!iconIndex) iconIndex = await (await fetch('../icons/lucide-index.json')).json();
  return iconIndex;
}

async function renderIconGrid() {
  const index = await loadIconIndex();
  const words = normalize($('#f-icon-search').value).split(/\s+/).filter(Boolean);
  const groups = words.map((w) => [w, ...(FR_WORDS[w] || '').split(' ').filter(Boolean)]);
  const matches = index.filter(([name, tags]) =>
    groups.every((alternatives) => alternatives.some((a) => name.includes(a) || tags.includes(a)))
  );
  const shown = matches.slice(0, 240);
  $('#f-icon-grid').replaceChildren(
    ...shown.map(([name]) => el('button', {
      type: 'button',
      class: selectedIcon.name === name ? 'icon-choice selected' : 'icon-choice',
      title: name,
      onclick: () => {
        selectIcon({ name });
        toggleIconPopover(false);
      },
    }, icon(name))),
    matches.length > shown.length ? el('div', { class: 'more' }, t('moreIcons', matches.length - shown.length)) : null,
    matches.length ? null : el('div', { class: 'more' }, t('noIcons')),
  );
}

// selectedIcon: { name } for a Lucide icon, or { image } for an imported image (data URL).
function selectIcon(choice) {
  selectedIcon = choice;
  $('#f-icon-preview').replaceChildren(choice.image ? el('img', { class: 'space-img', src: choice.image, alt: '' }) : icon(choice.name));
  for (const b of document.querySelectorAll('.icon-choice')) b.classList.toggle('selected', b.title === choice.name);
}

function toggleIconPopover(open) {
  const popover = $('#f-icon-popover');
  const preview = $('#f-icon-preview');
  popover.hidden = !open;
  popover.style.top = `${preview.offsetTop + preview.offsetHeight + 10}px`;
  preview.setAttribute('aria-expanded', String(open));
  if (open) {
    renderIconGrid();
    $('#f-icon-search').focus();
  }
}

// An imported icon is stored with the space in storage.sync (8 KB per item): small SVGs
// are kept as they are, anything else is redrawn as a 64 px image.
const ICON_MAX = 7000;

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function imageToIcon(file) {
  const original = await readAsDataUrl(file);
  if (file.type === 'image/svg+xml' && original.length <= ICON_MAX) return original;
  const img = new Image();
  img.src = original;
  await img.decode();
  for (const size of [64, 48, 32]) {
    const canvas = el('canvas', { width: size, height: size });
    const ratio = Math.min(size / (img.naturalWidth || size), size / (img.naturalHeight || size));
    const w = (img.naturalWidth || size) * ratio;
    const h = (img.naturalHeight || size) * ratio;
    canvas.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    for (const [type, quality] of [['image/png'], ['image/webp', 0.9]]) {
      const data = canvas.toDataURL(type, quality);
      if (data.length <= ICON_MAX) return data;
    }
  }
  throw new Error('too big');
}

// Color choice without the native picker (it would close the toolbar panel): a few
// swatches, plus a hue slider for any other color.
const COLORS = ['#7c6cf2', '#3d8bd9', '#2fb5c9', '#3fa37b', '#c9a227', '#e4834b', '#e5484d', '#d9577a', '#a35bd1', '#7d7a89'];

function hueToHex(hue) {
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    const c = 0.55 - 0.65 * 0.45 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHue(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

function colorPicker(box, value, onChange) {
  let current = value;
  const slider = el('input', { type: 'range', class: 'hue', min: '0', max: '359', 'aria-label': t('colorCustom') });
  const custom = el('button', { type: 'button', class: 'swatch custom', title: t('colorCustom'), 'aria-label': t('colorCustom') });
  const swatches = COLORS.map((hex) => {
    const swatch = el('button', { type: 'button', class: 'swatch', title: hex, 'aria-label': hex });
    swatch.style.setProperty('--swatch', hex);
    swatch.addEventListener('click', () => set(hex, false));
    return swatch;
  });
  function set(hex, fromSlider) {
    current = hex;
    const known = COLORS.includes(hex);
    for (const s of swatches) s.classList.toggle('selected', s.title === hex);
    custom.classList.toggle('selected', !known);
    custom.style.setProperty('--swatch', known ? '' : hex);
    if (!fromSlider) slider.hidden = known;
    onChange(hex);
  }
  custom.addEventListener('click', () => {
    slider.hidden = !slider.hidden;
    if (!slider.hidden) {
      slider.value = String(hexToHue(current));
      set(hueToHex(Number(slider.value)), true);
    }
  });
  slider.addEventListener('input', () => set(hueToHex(Number(slider.value)), true));
  box.replaceChildren(el('div', { class: 'swatches small' }, [...swatches, custom]), slider);
  set(value, false);
  return () => current;
}

// A destructive button asks to be clicked a second time (confirm() is not allowed in
// the toolbar panel).
function confirmButton(button, armedLabel, action) {
  const label = button.textContent;
  let timer = null;
  button.addEventListener('click', async () => {
    if (!button.classList.contains('armed')) {
      button.classList.add('armed');
      button.textContent = armedLabel;
      timer = setTimeout(() => { button.classList.remove('armed'); button.textContent = label; }, 4000);
      return;
    }
    clearTimeout(timer);
    button.classList.remove('armed');
    button.textContent = label;
    await action();
  });
}

const spaceBackground = (space) => space.background || (space.color2 ? 'gradient' : 'color');

function previewBackground(color, color2, background) {
  const root = document.documentElement;
  root.style.setProperty('--space', color);
  root.style.setProperty('--space2', background === 'gradient' ? color2 : color);
  root.dataset.bg = background;
}

async function initEditForm() {
  const isNew = params.get('edit') === 'new';
  const space = isNew
    ? { id: null, name: t('newSpaceName'), icon: 'lucide:sparkles', color: state.nextColor || COLORS[0], favorites: [] }
    : state.spaces.find((s) => s.id === params.get('edit'));
  if (!space) return closeDialog();
  document.title = isNew ? t('newSpace') : t('spaceWindowTitle', space.name);
  $('#f-title').textContent = isNew ? t('newSpace') : t('spaceFormTitle');
  $('#space-form').hidden = false;
  $('#f-name').value = space.name;
  selectIcon(space.icon === 'image' && space.iconImage
    ? { image: space.iconImage }
    : { name: space.icon && space.icon.startsWith('lucide:') ? space.icon.slice(7) : 'sparkles' });

  // Icon popover: Lucide search, or an imported image.
  $('#f-icon-preview').addEventListener('click', () => toggleIconPopover($('#f-icon-popover').hidden));
  document.addEventListener('mousedown', (e) => {
    if (!$('#f-icon-popover').hidden && !e.target.closest('#f-icon-popover, #f-icon-preview')) toggleIconPopover(false);
  });
  let searchTimer = null;
  $('#f-icon-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderIconGrid, 120);
  });
  $('#f-icon-upload').addEventListener('click', () => {
    // A file picker would close the toolbar panel: continue in a window.
    if (frame === 'panel') return send('openWindow', { query: `edit=${encodeURIComponent(space.id || 'new')}` }).then(closeDialog);
    return $('#f-icon-file').click();
  });
  $('#f-icon-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      selectIcon({ image: await imageToIcon(file) });
      toggleIconPopover(false);
    } catch (err) {
      toast(t('iconUnreadable'));
    }
  });

  // Colors and sidebar background, previewed live in this dialog.
  let background = spaceBackground(space);
  let color = null;
  let color2 = null;
  const update = () => color && color2 && previewBackground(color(), color2(), background);
  color = colorPicker($('#f-colors'), space.color, update);
  color2 = colorPicker($('#f-colors2'), space.color2 || COLORS[(COLORS.indexOf(space.color) + 3) % COLORS.length], update);
  for (const radio of document.querySelectorAll('input[name="f-bg"]')) {
    radio.checked = radio.value === background;
    radio.addEventListener('change', () => {
      background = radio.value;
      $('#f-color2-line').hidden = background !== 'gradient';
      update();
    });
  }
  $('#f-color2-line').hidden = background !== 'gradient';
  update();

  const select = $('#f-container');
  select.replaceChildren(
    el('option', { value: '' }, t('containerNone')),
    ...state.containers.map((c) => el('option', { value: c.id }, c.name)),
    el('option', { value: '__new__' }, t('containerCreate'))
  );
  select.value = state.containers.some((c) => c.id === space.cookieStoreId) ? space.cookieStoreId : '';
  select.addEventListener('change', () => { $('#f-new-container-row').hidden = select.value !== '__new__'; });
  $('#f-new-container').value = space.name;

  const archive = $('#f-archive');
  const delays = await send('archiveDelays');
  archive.replaceChildren(...delays.map((h) => el('option', { value: String(h) }, t(h ? `archiveAfter${h}` : 'archiveNever'))));
  archive.value = String(space.archiveAfter || 0);

  $('#f-sites').value = (space.sites || []).join('\n');
  const slots = scheduleSlots(space.schedule);
  $('#f-sched-on').checked = slots.length > 0;
  for (const slot of slots.length ? slots : [{ days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' }]) addSlot(slot);
  $('#f-sched-add').addEventListener('click', () => {
    const rows = document.querySelectorAll('.slot');
    const last = rows.length ? readSlot(rows[rows.length - 1]) : null;
    addSlot(last ? { days: last.days, from: last.to, to: last.to < '23:00' ? `${String(Number(last.to.slice(0, 2)) + 1).padStart(2, '0')}${last.to.slice(2)}` : '23:59' }
      : { days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' });
  });
  const toggleSchedule = () => {
    $('#f-sched-row').hidden = !$('#f-sched-on').checked;
    if ($('#f-sched-on').checked && !document.querySelector('.slot')) addSlot({ days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' });
  };
  $('#f-sched-on').addEventListener('change', toggleSchedule);
  toggleSchedule();

  $('#f-name').select();
  $('#f-cancel').addEventListener('click', closeDialog);

  $('#f-delete').hidden = isNew;
  $('#f-delete').disabled = state.spaces.length < 2;
  confirmButton($('#f-delete'), t('deleteArmed'), async () => {
    await send('deleteSpace', { spaceId: space.id });
    closeDialog();
  });

  $('#space-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { sites, rejected } = parseSites($('#f-sites').value);
    if (rejected.length) {
      $('#f-sites').focus();
      return toast(t('spaceSitesRejected', rejected.join(', ')));
    }
    const slots = [...document.querySelectorAll('.slot')].map(readSlot);
    if ($('#f-sched-on').checked && slots.some((x) => !x.days.length || !x.from || !x.to || x.from === x.to)) {
      return toast(t('scheduleInvalid'));
    }
    let cookieStoreId = select.value || null;
    let containerName = null;
    if (cookieStoreId === '__new__') {
      containerName = $('#f-new-container').value.trim() || $('#f-name').value.trim();
      cookieStoreId = await send('createContainer', { name: containerName });
    } else if (cookieStoreId) {
      containerName = state.containers.find((c) => c.id === cookieStoreId).name;
    }
    const data = {
      icon: selectedIcon.image ? 'image' : `lucide:${selectedIcon.name}`,
      iconImage: selectedIcon.image || null,
      archiveAfter: Number($('#f-archive').value) || 0,
      background,
      color2: background === 'gradient' ? color2() : null,
      sites,
      schedule: $('#f-sched-on').checked && slots.length ? { slots } : null,
      name: $('#f-name').value.trim() || t('spaceFallbackName'),
      color: color(),
      cookieStoreId,
      containerName,
    };
    if (isNew) await send('createSpace', { space: data });
    else await send('saveSpace', { space: { id: space.id, ...data } });
    closeDialog();
  });
}

// "https://www.example.com/page" or "example.com" -> "example.com"
// --- Time slots of a space (automatic switch) -------------------------------------
// A slot: days (Date.getDay() numbers, 0 = Sunday) and a time range. Same format as
// scheduleSlots() in background.js, which also reads the single slot of older versions.

const DAY_SETS = { all: [0, 1, 2, 3, 4, 5, 6], week: [1, 2, 3, 4, 5], weekend: [0, 6] };
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

function scheduleSlots(rule) {
  if (!rule || typeof rule !== 'object') return [];
  if (Array.isArray(rule.slots)) return rule.slots;
  return [{ days: DAY_SETS[rule.days] || DAY_SETS.all, from: rule.from, to: rule.to }];
}

// Day names in the interface language (2024-01-07 was a Sunday).
function dayName(day, style) {
  return new Intl.DateTimeFormat(browser.i18n.getUILanguage(), { weekday: style }).format(new Date(2024, 0, 7 + day));
}

function addSlot(slot) {
  const days = new Set(slot.days || []);
  const chips = WEEK_ORDER.map((day) => el('button', {
    type: 'button',
    class: days.has(day) ? 'day on' : 'day',
    title: dayName(day, 'long'),
    'aria-label': dayName(day, 'long'),
    'aria-pressed': String(days.has(day)),
    onclick: (e) => {
      const on = e.currentTarget.classList.toggle('on');
      e.currentTarget.setAttribute('aria-pressed', String(on));
    },
  }, dayName(day, 'narrow')));
  chips.forEach((chip, i) => { chip.dataset.day = String(WEEK_ORDER[i]); });
  const row = el('div', { class: 'slot' }, [
    el('div', { class: 'days', role: 'group', 'aria-label': t('scheduleDays') }, chips),
    el('button', {
      type: 'button',
      class: 'slot-remove',
      title: t('scheduleRemoveSlot'),
      'aria-label': t('scheduleRemoveSlot'),
      onclick: () => {
        row.remove();
        if (!document.querySelector('.slot')) $('#f-sched-on').click();
      },
    }, icon('x')),
    el('span', { class: 'times' }, [
      el('input', { type: 'time', class: 'from', value: slot.from || '09:00', 'aria-label': t('scheduleFrom') }),
      el('span', {}, '→'),
      el('input', { type: 'time', class: 'to', value: slot.to || '18:00', 'aria-label': t('scheduleTo') }),
    ]),
  ]);
  $('#f-sched-slots').append(row);
}

function readSlot(row) {
  return {
    days: [...row.querySelectorAll('.day.on')].map((chip) => Number(chip.dataset.day)).sort(),
    from: row.querySelector('.from').value,
    to: row.querySelector('.to').value,
  };
}

// "*" stands for any part of the address: dev.*.example.com. Returns the valid sites and
// the entries that are not an address, so that nothing disappears silently.
function parseSites(text) {
  const entries = text.split(/[\s,;]+/).map((line) => line.trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, ''))
    .filter(Boolean);
  const valid = (d) => /^[a-z0-9*-]+(\.[a-z0-9*-]+)+$/.test(d) && /[a-z0-9]/.test(d.replace(/\*/g, ''));
  return { sites: [...new Set(entries.filter(valid))], rejected: entries.filter((d) => !valid(d)) };
}

// --- "Edit group" window -----------------------------------------------------


async function initGroupForm() {
  const groupId = Number(params.get('group'));
  const group = await send('getGroup', { groupId });
  if (!group) return closeDialog();
  document.title = t('groupFormTitle');
  $('#group-form').hidden = false;
  $('#g-title').value = group.title || '';
  let color = group.color;

  const swatches = Object.entries(GROUP_COLORS).map(([name, hex]) => {
    const swatch = el('button', {
      type: 'button',
      class: name === color ? 'swatch selected' : 'swatch',
      title: t('color' + name[0].toUpperCase() + name.slice(1)),
      role: 'radio',
      'aria-checked': String(name === color),
      'aria-label': t('color' + name[0].toUpperCase() + name.slice(1)),
      onclick: () => {
        color = name;
        for (const s of swatches) {
          s.classList.toggle('selected', s === swatch);
          s.setAttribute('aria-checked', String(s === swatch));
        }
      },
    });
    swatch.style.setProperty('--swatch', hex);
    return swatch;
  });
  $('#g-colors').replaceChildren(...swatches);
  $('#g-title').select();

  $('#g-cancel').addEventListener('click', closeDialog);
  $('#group-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await send('updateGroup', { groupId, changes: { title: $('#g-title').value.trim(), color } });
    closeDialog();
  });
}

// --- "Archive" window: tabs automatically stored from the active space -------

function ago(time) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 60) return t('agoMinutes', Math.max(1, minutes));
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t('agoHours', hours);
  return t('agoDays', Math.round(hours / 24));
}

async function initArchive() {
  const space = currentSpace();
  document.title = t('archiveWindowTitle', space.name);
  $('#archive-panel').hidden = false;
  $('#archive-heading').replaceChildren(spaceIcon(space, 'ic space-icon'), ` ${t('archiveWindowTitle', space.name)}`);
  let entries = [];

  const render = () => {
    const words = $('#archive-search').value.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = entries.filter((x) => words.every((w) => `${x.title} ${x.url}`.toLowerCase().includes(w)));
    $('#archive-clear').disabled = !entries.length;
    if (!shown.length) {
      $('#archive-list').replaceChildren(el('li', { class: 'more' }, entries.length ? t('archiveNoMatch') : t('archiveEmpty')));
      return;
    }
    $('#archive-list').replaceChildren(...shown.map((x) => el('li', { class: 'archived' }, [
      el('button', {
        class: 'archived-open',
        title: x.url,
        onclick: async () => {
          await send('reopenArchived', { spaceId: space.id, url: x.url });
          closeDialog();
        },
      }, [
        favicon(x.favIconUrl, x.title),
        el('span', { class: 'archived-text' }, [
          el('span', { class: 'archived-title' }, x.title),
          el('span', { class: 'archived-sub' }, `${hostOf(x.url)} · ${ago(x.archivedAt)}`),
        ]),
      ]),
      el('button', {
        class: 'archived-remove',
        title: t('archiveRemove'),
        'aria-label': t('archiveRemove'),
        onclick: async () => {
          await send('removeArchived', { spaceId: space.id, url: x.url });
          entries = entries.filter((y) => y !== x);
          render();
        },
      }, icon('x')),
    ])));
  };

  entries = (await send('getArchive'))[space.id] || [];
  render();
  $('#archive-search').addEventListener('input', render);
  $('#archive-search').focus();
  $('#archive-close').addEventListener('click', closeDialog);
  confirmButton($('#archive-clear'), t('clearArmed'), async () => {
    await send('removeArchived', { spaceId: space.id, url: null });
    entries = [];
    render();
  });
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return url;
  }
}

// --- "Settings" window -------------------------------------------------------

function initSettings() {
  document.title = t('settings');
  $('#settings-panel').hidden = false;
  $('#s-new-space').addEventListener('click', () => goToDialog('edit=new'));
  $('#s-clear').addEventListener('click', async () => {
    await send('clearSpace', { spaceId: state.activeSpaceId });
    toast(t('tabsClosed'));
  });
  $('#s-share').addEventListener('click', () => goToDialog('share=1'));
  $('#s-setup').addEventListener('click', () => goToDialog('setup=1'));

  // Search suggestions: the OpenSearch address of one's engine. Arbalète needs the right
  // to reach that site, asked here (user gesture).
  const suggest = $('#s-suggest');
  browser.storage.local.get('suggestUrl').then((s) => { suggest.value = s.suggestUrl || ''; });
  $('#s-suggest-save').addEventListener('click', async () => {
    const value = suggest.value.trim();
    if (!value) {
      await browser.storage.local.remove('suggestUrl');
      return toast(t('settingsSuggestSaved'));
    }
    let origin;
    try {
      origin = new URL(value.replace(/{searchTerms}|%s/g, 'test')).origin;
    } catch (e) {
      origin = null;
    }
    if (!origin || !/{searchTerms}|%s/.test(value)) return toast(t('settingsSuggestInvalid'));
    if (!(await askPermission({ origins: [`${origin}/*`] }, value))) return undefined;
    await browser.storage.local.set({ suggestUrl: value });
    return toast(t('settingsSuggestSaved'));
  });

  // History in quick search: optional permission, asked here.
  const history = $('#s-history');
  const HISTORY = { permissions: ['history'] };
  const checkHistory = () => send('hasPermission', { permissions: HISTORY }).then((granted) => { history.checked = granted; });
  checkHistory();

  // Centered dialogs: the "all sites" permission (the one split view also uses) lets the
  // sidebar open them as an overlay over the page instead of the toolbar panel.
  const center = $('#s-center');
  const ALL_SITES = { origins: ['<all_urls>'] };
  const checkCenter = () => send('hasPermission', { permissions: ALL_SITES }).then((granted) => { center.checked = granted; });
  checkCenter();
  center.addEventListener('change', async () => {
    if (center.checked) center.checked = await askPermission(ALL_SITES);
    else await send('removePermission', { permissions: ALL_SITES });
  });
  // Answer of the small permission window (see askPermission).
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.permissionsChangedAt) {
      checkHistory();
      checkCenter();
    }
    if (changes.suggestUrl) {
      suggest.value = changes.suggestUrl.newValue || '';
      toast(t('settingsSuggestSaved'));
    }
  });
  history.addEventListener('change', async () => {
    if (history.checked) history.checked = await askPermission(HISTORY);
    else await send('removePermission', { permissions: HISTORY });
  });
  const theme = $('#s-theme');
  browser.storage.local.get('tintTheme').then((s) => { theme.checked = !!s.tintTheme; });
  theme.addEventListener('change', () => browser.storage.local.set({ tintTheme: theme.checked }));
  renderStats();

  const expand = $('#s-expand');
  browser.storage.local.get('expandOnHover').then((s) => { expand.checked = !!s.expandOnHover; });
  expand.addEventListener('change', () => {
    browser.storage.local.set({ expandOnHover: expand.checked });
    toast(t(expand.checked ? 'expandOn' : 'expandOff'));
  });
  $('#s-shortcuts').addEventListener('click', () => send('openShortcuts').then(closeDialog));
  $('#s-welcome').addEventListener('click', () => send('openWelcome').then(closeDialog));
}

// Optional permissions can only be asked from a privileged page, during a click: not
// from the overlay (no permissions API), nor from the toolbar panel (the prompt closes
// it). There, a small window asks instead and reports back through storage.local.
async function askPermission(permissions, suggestUrl = '') {
  if (frame === 'window' && browser.permissions) return browser.permissions.request(permissions);
  const query = `grant=${encodeURIComponent(JSON.stringify(permissions))}${suggestUrl ? `&suggest=${encodeURIComponent(suggestUrl)}` : ''}`;
  await send('openWindow', { query, small: true });
  return false;
}

// --- Small permission window (?grant=<permissions as JSON>) ---------------------------------

function initGrant() {
  let permissions;
  try {
    permissions = JSON.parse(params.get('grant'));
  } catch (e) {
    return closeDialog();
  }
  const suggestUrl = params.get('suggest') || '';
  const origins = permissions.origins || [];
  let kind = 'Suggest';
  if ((permissions.permissions || []).includes('history')) kind = 'History';
  else if (origins.includes('<all_urls>')) kind = 'Center';
  let host = '';
  try {
    host = new URL(origins[0].replace('/*', '/')).host;
  } catch (e) {
    host = '';
  }
  document.title = t(`grant${kind}Title`);
  $('#grant-panel').hidden = false;
  $('#grant-title').textContent = document.title;
  $('#grant-text').textContent = t(`grant${kind}Text`, host);
  $('#grant-cancel').addEventListener('click', closeDialog);
  $('#grant-allow').addEventListener('click', async () => {
    if (!(await browser.permissions.request(permissions))) return;
    const changes = { permissionsChangedAt: Date.now() };
    if (suggestUrl) changes.suggestUrl = suggestUrl;
    await browser.storage.local.set(changes);
    closeDialog();
  });
  $('#grant-allow').focus();
}

// Statistics: minutes spent per space, today and over 7 days.
async function renderStats() {
  const stats = await send('getStats');
  const days = Object.keys(stats).sort().slice(-7);
  const today = new Date().toISOString().slice(0, 10);
  const total = (spaceId, list) => list.reduce((sum, d) => sum + ((stats[d] || {})[spaceId] || 0), 0);
  const rows = state.spaces.map((s) => ({ s, week: total(s.id, days), today: total(s.id, [today]) }));
  const max = Math.max(1, ...rows.map((r) => r.week));
  const duration = (minutes) => (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`);
  $('#s-stats').replaceChildren(
    ...rows.map(({ s, week, today: day }) => {
      const bar = el('span', { class: 'stat-bar' });
      bar.style.setProperty('--w', `${(week / max) * 100}%`);
      bar.style.setProperty('--c', s.color);
      return el('div', { class: 'stat', title: t('statsTooltip', s.name, duration(day), duration(week)) }, [
        el('span', { class: 'stat-name' }, [spaceIcon(s, 'ic'), ` ${s.name}`]),
        bar,
        el('span', { class: 'stat-value' }, duration(week)),
      ]);
    }),
    el('p', { class: 'hint' }, t('statsHint')),
  );
}

// --- "Single sidebar" window: installs userChrome.css ------------------------

// The Windows installer is a .cmd that contains its own PowerShell script and the
// CSS: cmd launches PowerShell, which rereads the file and runs the part after the
// PS1 marker (the markers are written in two pieces so they do not find themselves).
// The CSS is stored between two marker comments in userChrome.css, which
// preserves existing customizations and allows the installer to be run again.
const INSTALLER_PS = String.raw`
$ErrorActionPreference = 'Stop'
$content = Get-Content -LiteralPath $f -Raw -Encoding UTF8
$css = ($content -split ('#' + 'CSS#'))[1].Trim()
$start = '/* === ARBALETE DEBUT === */'
$end = '/* === ARBALETE FIN === */'
$utf8 = New-Object System.Text.UTF8Encoding $false
$nl = [Environment]::NewLine
$root = Join-Path $env:APPDATA 'Mozilla\Firefox'
$ini = Join-Path $root 'profiles.ini'
if (-not (Test-Path $ini)) { Write-Host $msgNoFirefox; return }
$count = 0
foreach ($line in Get-Content $ini) {
  if ($line -notlike 'Path=*') { continue }
  $p = $line.Substring(5)
  if (-not [System.IO.Path]::IsPathRooted($p)) { $p = Join-Path $root $p }
  if (-not (Test-Path (Join-Path $p 'prefs.js'))) { continue }

  $userJs = Join-Path $p 'user.js'
  $hasPref = (Test-Path $userJs) -and (Select-String -LiteralPath $userJs -SimpleMatch 'legacyUserProfileCustomizations' -Quiet)
  if (-not $hasPref) {
    [System.IO.File]::AppendAllText($userJs, $nl + 'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);' + $nl, $utf8)
  }

  $chrome = Join-Path $p 'chrome'
  New-Item -ItemType Directory -Force -Path $chrome | Out-Null
  $file = Join-Path $chrome 'userChrome.css'
  $old = ''
  if (Test-Path $file) { $old = [System.IO.File]::ReadAllText($file) }
  if ($old.Contains($start)) {
    $old = [regex]::Replace($old, [regex]::Escape($start) + '[\s\S]*?' + [regex]::Escape($end), '')
  } elseif ($old.Contains('Arbal') -and $old.Contains('#sidebar-box')) {
    $old = ''
  }
  $new = ($old.Trim() + $nl + $nl + $start + $nl + $css + $nl + $end + $nl).TrimStart()
  [System.IO.File]::WriteAllText($file, $new, $utf8)
  Write-Host ($msgProfileDone + (Split-Path $p -Leaf))
  $count++
}
Write-Host ''
if ($count) { Write-Host $msgDone }
else { Write-Host $msgNoProfile }
`;

// The Windows console displays accents badly: they are removed in the .cmd.
const plain = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'");

// Installer messages, as PowerShell variables (apostrophes doubled).
function installerMessages() {
  const ps = (text) => `'${plain(text).replace(/'/g, "''")}'`;
  return [
    `$msgNoFirefox = ${ps(t('installerNoFirefox'))}`,
    `$msgProfileDone = ${ps(t('installerProfileDone'))}`,
    `$msgDone = ${ps(t('installerDone'))}`,
    `$msgNoProfile = ${ps(t('installerNoProfile'))}`,
    '',
  ].join('\r\n');
}

// Linux and macOS installer: an sh script that contains the CSS in a here-doc (written
// to a temporary file: macOS's bash 3.2 mishandles a here-doc inside $(...)).
// It looks for profiles.ini in all known locations: distribution Firefox
// (~/.mozilla or ~/.config/mozilla, depending on the version), Flatpak, Snap (Ubuntu) and macOS.
// Same logic as on Windows: preference in user.js, CSS between the two markers.
const INSTALLER_SH = String.raw`
START='/* === ARBALETE DEBUT === */'
END='/* === ARBALETE FIN === */'
CSS=$(cat "$CSS_FILE")
rm -f "$CSS_FILE"
[ -n "$XDG_CONFIG_HOME" ] || XDG_CONFIG_HOME=$HOME/.config
found=0
count=0
for root in \
  "$HOME/Library/Application Support/Firefox" \
  "$HOME/.mozilla/firefox" \
  "$XDG_CONFIG_HOME/mozilla/firefox" \
  "$HOME/.var/app/org.mozilla.firefox/.mozilla/firefox" \
  "$HOME/.var/app/org.mozilla.firefox/config/mozilla/firefox" \
  "$HOME/snap/firefox/common/.mozilla/firefox"
do
  [ -f "$root/profiles.ini" ] || continue
  found=1
  paths=$(grep '^Path=' "$root/profiles.ini" | cut -d= -f2- | tr -d '\r')
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    case $p in /*) dir=$p ;; *) dir=$root/$p ;; esac
    [ -f "$dir/prefs.js" ] || continue

    if ! grep -q legacyUserProfileCustomizations "$dir/user.js" 2>/dev/null; then
      printf '\nuser_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);\n' >> "$dir/user.js"
    fi

    mkdir -p "$dir/chrome"
    file=$dir/chrome/userChrome.css
    old=''
    if [ -f "$file" ]; then
      if grep -qF "$START" "$file"; then
        old=$(awk -v s="$START" -v e="$END" 'index($0, s) { skip = 1 } !skip { print } index($0, e) { skip = 0 }' "$file")
      elif ! { grep -q 'Arbal' "$file" && grep -q '#sidebar-box' "$file"; }; then
        old=$(cat "$file")
      fi
    fi
    {
      if [ -n "$(printf '%s' "$old" | tr -d ' \t\r\n')" ]; then printf '%s\n\n' "$old"; fi
      printf '%s\n%s\n%s\n' "$START" "$CSS" "$END"
    } > "$file"
    echo "$MSG_PROFILE_DONE$(basename "$dir")"
    count=$((count + 1))
  done <<EOF
$paths
EOF
done
echo
if [ "$found" = 0 ]; then echo "$MSG_NO_FIREFOX"
elif [ "$count" = 0 ]; then echo "$MSG_NO_PROFILE"
else echo "$MSG_DONE"
fi
exit 0
`;

function shInstaller(css) {
  const sh = (text) => `'${text.replace(/'/g, "'\\''")}'`;
  return [
    '#!/bin/sh',
    '# Arbalète: hides Firefox\'s own tabs while the Arbalète sidebar is open.',
    `# ${t('setupUnixCommandHint')}`,
    `echo ${sh(t('installerRunning'))}`,
    `MSG_NO_FIREFOX=${sh(t('installerNoFirefox'))}`,
    `MSG_PROFILE_DONE=${sh(t('installerProfileDone'))}`,
    `MSG_DONE=${sh(t('installerDone'))}`,
    `MSG_NO_PROFILE=${sh(t('installerNoProfile'))}`,
    'CSS_FILE=$(mktemp)',
    "cat > \"$CSS_FILE\" <<'ARBALETE_CSS'",
    css.replace(/\r\n/g, '\n').trimEnd(),
    'ARBALETE_CSS',
    INSTALLER_SH.trim(),
    '',
  ].join('\n');
}

// Command to paste in a terminal (the file arrives in the download folder).
const unixCommand = (os) => (os === 'mac'
  ? 'sh ~/Downloads/installer-arbalete.sh'
  : 'sh "$(xdg-user-dir DOWNLOAD)/installer-arbalete.sh"');

async function userChromeCss() {
  return (await fetch('../userChrome.css')).text();
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const link = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

async function initSetup() {
  document.title = t('setupWindowTitle');
  $('#setup-panel').hidden = false;
  const os = await send('platform');
  const unix = os === 'linux' || os === 'mac' || os === 'openbsd';
  $('#setup-windows').hidden = os !== 'win';
  $('#setup-unix').hidden = !unix;
  if (!unix && os !== 'win') $('#setup-manual').open = true;

  $('#setup-unix-command').textContent = unixCommand(os);
  $('#setup-unix-download').addEventListener('click', async () => {
    download('installer-arbalete.sh', shInstaller(await userChromeCss()), 'application/x-sh');
    browser.storage.local.set({ setupDone: true });
  });
  $('#setup-unix-copy').addEventListener('click', async () => {
    await send('copyText', { text: unixCommand(os) });
    $('#setup-unix-copy').textContent = t('copied');
  });

  $('#setup-download-script').addEventListener('click', async () => {
    const batch = [
      '@echo off',
      `echo ${plain(t('installerRunning'))}`,
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%~f0'; $s=(Get-Content -LiteralPath $f -Raw -Encoding UTF8) -split ('#'+'PS1#'); iex (($s[1] -split ('#'+'CSS#'))[0])"`,
      'pause',
      'exit /b',
      '#PS1#',
      installerMessages() + INSTALLER_PS.trim(),
      '#CSS#',
      await userChromeCss(),
    ].join('\r\n');
    download('installer-arbalete.cmd', batch, 'application/octet-stream');
    browser.storage.local.set({ setupDone: true });
  });
  $('#setup-download-css').addEventListener('click', async () => {
    download('userChrome.css', await userChromeCss(), 'text/css');
    browser.storage.local.set({ setupDone: true });
  });
}

// --- First run assistant (?welcome=1, in a tab) --------------------------------------------
// 1. spaces: starters to pick and rename, a template file, or the spaces already synced by
// Firefox Sync; 2. a single sidebar (the setup dialog, moved here); 3. useful settings.

const STARTERS = [
  { key: 'spacePersonal', icon: 'house', color: '#7c6cf2', on: true },
  { key: 'spaceWork', icon: 'briefcase', color: '#e4834b', on: true },
  { key: 'starterStudies', icon: 'graduation-cap', color: '#3d8bd9' },
  { key: 'starterProjects', icon: 'rocket', color: '#3fa37b' },
  { key: 'starterHobbies', icon: 'gamepad-2', color: '#d9577a' },
  { key: 'starterShopping', icon: 'shopping-cart', color: '#c9a227' },
];

// The two spaces created on install, untouched: nothing came through Firefox Sync.
const onlyDefaultSpaces = (spaces) => spaces.length === 2
  && spaces.every((s) => ['perso', 'boulot'].includes(s.id) && !s.favorites.length && !(s.sites || []).length && !s.schedule);

async function initWelcome() {
  document.title = t('welcomeTitle');
  $('#welcome-panel').hidden = false;
  let step = 1;

  const showSynced = () => {
    $('#w-fresh').hidden = true;
    $('#w-synced').hidden = false;
    $('#w-synced-list').replaceChildren(...state.spaces.map((s) => el('div', { class: 'line' }, el('span', { class: 'pick-name' }, [spaceIcon(s), el('span', {}, s.name)]))));
  };
  const starters = STARTERS.map((starter) => {
    const toggle = el('input', { type: 'checkbox', class: 'switch', checked: !!starter.on, 'aria-label': t(starter.key) });
    const name = el('input', { value: t(starter.key), maxLength: 40, 'aria-label': t('name') });
    const swatch = icon(starter.icon);
    swatch.style.color = starter.color;
    $('#w-starters').append(el('div', { class: 'line starter' }, [el('span', { class: 'pick-name' }, [swatch, name]), toggle]));
    return { starter, toggle, name };
  });
  if (!onlyDefaultSpaces(state.spaces)) showSynced();

  // A template file replaces the starting spaces (nothing to keep yet).
  const file = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  document.body.append(file);
  $('#w-import').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    try {
      const spaces = JSON.parse(await file.files[0].text()).spaces;
      if (!Array.isArray(spaces) || !spaces.length) throw new Error('no spaces');
      await send('importSpaces', { spaces, mode: onlyDefaultSpaces(state.spaces) ? 'replace' : 'add' });
      state = await send('getState');
      showSynced();
      toast(t('spacesImported'));
    } catch (err) {
      toast(t('fileNotRecognized'));
    }
    file.value = '';
  });

  // Step 2: the setup dialog, moved into the assistant.
  $('#w-setup-slot').append($('#setup-panel'));
  await initSetup();
  document.title = t('welcomeTitle');

  // Step 3: settings (a tab: the permission requests work here).
  const ALL_SITES = { origins: ['<all_urls>'] };
  const HISTORY = { permissions: ['history'] };
  const center = $('#w-center');
  const history = $('#w-history');
  const theme = $('#w-theme');
  const perms = browser.permissions; // always there in the tab
  center.checked = perms ? await perms.contains(ALL_SITES) : false;
  history.checked = perms ? await perms.contains(HISTORY) : false;
  theme.checked = !!(await browser.storage.local.get('tintTheme')).tintTheme;
  center.addEventListener('change', async () => {
    if (center.checked) center.checked = await browser.permissions.request(ALL_SITES);
    else await browser.permissions.remove(ALL_SITES);
  });
  history.addEventListener('change', async () => {
    if (history.checked) history.checked = await browser.permissions.request(HISTORY);
    else await browser.permissions.remove(HISTORY);
  });
  theme.addEventListener('change', () => browser.storage.local.set({ tintTheme: theme.checked }));

  const show = () => {
    for (let i = 1; i <= 3; i++) $(`#w-step-${i}`).hidden = i !== step;
    document.querySelectorAll('.steps li').forEach((li, i) => {
      li.className = i + 1 === step ? 'current' : i + 1 < step ? 'done' : '';
    });
    $('#w-back').hidden = step === 1;
    $('#w-next').textContent = t(step === 3 ? 'welcomeDone' : 'welcomeNext');
    window.scrollTo(0, 0);
  };
  $('#w-back').addEventListener('click', () => { step -= 1; show(); });
  $('#w-next').addEventListener('click', async () => {
    if (step === 1 && $('#w-synced').hidden) {
      const picked = starters.filter((s) => s.toggle.checked);
      if (!picked.length) return toast(t('shareNothing'));
      await send('importSpaces', {
        mode: 'replace',
        spaces: picked.map(({ starter, name }) => ({
          name: name.value.trim() || t(starter.key), icon: `lucide:${starter.icon}`, color: starter.color, favorites: [],
        })),
      });
      state = await send('getState');
      showSynced();
    }
    if (step < 3) {
      step += 1;
      return show();
    }
    await browser.storage.local.set({ setupDismissed: true });
    const tab = await browser.tabs.getCurrent();
    return tab ? browser.tabs.remove(tab.id) : window.close();
  });
  show();
}

// --- "Share spaces" dialog (?share=1) ------------------------------------------------
// Export: a selection of spaces, with or without their favorites, to a file. Import: the
// spaces of a file, chosen one by one, added next to the current ones (a template) or
// replacing them (moving to another PC).

// One row per space, with a switch; returns a function giving the chosen spaces.
function spacePicker(box, list) {
  const rows = list.map((space) => {
    const input = el('input', { type: 'checkbox', class: 'switch', checked: true });
    box.append(el('label', { class: 'line' }, [
      el('span', { class: 'pick-name' }, [spaceIcon(space), el('span', {}, space.name)]),
      input,
    ]));
    return { space, input };
  });
  return () => rows.filter((r) => r.input.checked).map((r) => r.space);
}

function saveFile(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const link = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

const fileSlug = (name) => name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'espace';

function initShare() {
  document.title = t('shareTitle');
  $('#share-panel').hidden = false;

  const chosen = spacePicker($('#share-export-list'), state.spaces);
  $('#share-export').addEventListener('click', async () => {
    const picked = chosen();
    if (!picked.length) return toast(t('shareNothing'));
    const spaces = await send('exportSpaces', { ids: picked.map((s) => s.id), withFavorites: $('#share-favorites').checked });
    saveFile(picked.length === 1 ? `arbalete-${fileSlug(picked[0].name)}.json` : t('exportFileName'), { arbalete: 1, spaces });
    return toast(t('shareExported', picked.length));
  });

  const input = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  document.body.append(input);
  $('#share-pick').addEventListener('click', () => {
    // A file picker would close the toolbar panel: continue in a window.
    if (frame === 'panel') return send('openWindow', { query: 'share=1' }).then(closeDialog);
    return input.click();
  });
  let fromFile = null;
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    let spaces;
    try {
      spaces = JSON.parse(await file.text()).spaces;
      if (!Array.isArray(spaces) || !spaces.length) throw new Error('no spaces');
    } catch (err) {
      toast(t('fileNotRecognized'));
      return;
    }
    $('#share-import-list').replaceChildren();
    $('#share-import-list').hidden = false;
    $('#share-import-actions').hidden = false;
    $('#share-pick').lastChild.textContent = file.name;
    fromFile = spacePicker($('#share-import-list'), spaces.map((s) => ({ ...s, name: String(s.name || t('spaceFallbackName')) })));
  });
  const apply = async (importMode) => {
    const picked = fromFile ? fromFile() : [];
    if (!picked.length) return toast(t('shareNothing'));
    await send('importSpaces', { spaces: picked, mode: importMode });
    toast(t('spacesImported'));
    return setTimeout(closeDialog, 700);
  };
  $('#share-add').addEventListener('click', () => apply('add'));
  confirmButton($('#share-replace'), t('replaceArmed'), () => apply('replace'));
}

// --- Synchronization with the background script ------------------------------

let refreshTimer = null;
async function refresh() {
  state = await send('getState');
  render();
}

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'refresh' && mode === 'sidebar') {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 20);
  } else if (message.type === 'toast' && mode === 'sidebar') {
    toast(message.text);
  }
});

// Page texts: data-i18n (text), data-i18n-title, data-i18n-placeholder, data-i18n-label.
function applyI18n() {
  document.documentElement.lang = browser.i18n.getUILanguage();
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-icon]')) node.prepend(icon(node.dataset.icon));
  for (const node of document.querySelectorAll('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle);
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of document.querySelectorAll('[data-i18n-label]')) node.setAttribute('aria-label', t(node.dataset.i18nLabel));
}

// Dialog behavior shared by every frame: closing, height of the overlay, focus.
async function initDialogFrame() {
  document.body.classList.add('dialog', `frame-${frame}`);
  if (frame === 'overlay') {
    // Framed by a page: only go on if Arbalète opened this overlay.
    if (!(await send('claimDialog', { token: params.get('token') }))) {
      document.body.replaceChildren();
      return false;
    }
    new ResizeObserver(() => {
      window.parent.postMessage({ from: 'arbalete-palette', type: 'arbalete-palette-height', height: document.body.scrollHeight }, '*');
    }).observe(document.body);
    window.addEventListener('message', (e) => {
      if (!e.data || e.data.type !== 'arbalete-palette-focus') return;
      const first = document.querySelector('.panel:not([hidden]) :is(.name-input, input[type=search])');
      if (first && !document.activeElement.matches('input, textarea, select')) first.focus();
    });
  }
  // Back to quick search for the next click on the toolbar button.
  if (frame === 'panel') browser.browserAction.setPopup({ popup: null });
  for (const button of document.querySelectorAll('.dialog-close')) button.addEventListener('click', closeDialog);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || mode === 'welcome') return;
    const popover = document.querySelector('.popover:not([hidden])');
    if (popover) toggleIconPopover(false);
    else closeDialog();
  });
  return true;
}

(async () => {
  applyI18n();
  document.body.classList.add(`mode-${mode}`);
  if (mode !== 'sidebar' && !(await initDialogFrame())) return;
  windowId = mode === 'sidebar' ? (await browser.windows.getCurrent()).id : Number(params.get('win'));
  await refresh();
  if (mode === 'sidebar') initSidebar();
  else if (mode === 'edit') await initEditForm();
  else if (mode === 'group') await initGroupForm();
  else if (mode === 'setup') await initSetup();
  else if (mode === 'archive') await initArchive();
  else if (mode === 'grant') initGrant();
  else if (mode === 'share') initShare();
  else if (mode === 'welcome') await initWelcome();
  else initSettings();
})();
