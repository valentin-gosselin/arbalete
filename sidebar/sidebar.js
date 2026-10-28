'use strict';

// Barre latérale d'Arbalète : affiche l'espace actif de SA fenêtre. Toute la
// logique (masquage des onglets, synchro, menus) est dans background.js ; ici on
// ne fait qu'afficher l'état et envoyer des messages.
// La même page sert aussi de petite fenêtre : ?edit=<espace>&win=<fenêtre> pour
// modifier un espace, ?settings=1&win=<fenêtre> pour les réglages.

const $ = (sel) => document.querySelector(sel);
const t = (key, ...subs) => browser.i18n.getMessage(key, subs.map(String)) || key;
const send = (type, data = {}) => browser.runtime.sendMessage({ type, windowId, ...data });

const params = new URLSearchParams(location.search);
const mode = ['edit', 'group', 'settings', 'setup'].find((m) => params.has(m)) || 'sidebar';

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

// Icône d'un espace : « lucide:nom », ou un ancien emoji (versions 0.1.x).
function spaceIcon(space, className) {
  const value = space.icon || '';
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

// Page sans favicon (nouvel onglet, page interne) : globe gris, comme Firefox.
function defaultFavicon() {
  return icon('globe', 'ic favicon default');
}

function currentSpace() {
  return state.spaces.find((s) => s.id === state.activeSpaceId) || state.spaces[0];
}

// --- Rendu de la barre ------------------------------------------------------------

function render() {
  const space = currentSpace();
  const index = state.spaces.indexOf(space);
  document.documentElement.style.setProperty('--space', space.color);
  if (mode !== 'sidebar') return;

  renderFavorites(space);
  renderTabs(space);
  renderSpaces(space);

  if (previousSpaceIndex !== -1 && previousSpaceIndex !== index) {
    const list = $('#tabs');
    list.classList.remove('slide-left', 'slide-right');
    void list.offsetWidth; // relance l'animation
    list.classList.add(index > previousSpaceIndex ? 'slide-left' : 'slide-right');
  }
  previousSpaceIndex = index;
}

function renderFavorites(space) {
  $('#favorites').replaceChildren(
    ...space.favorites.map((fav) => {
      const tab = state.tabs.find((t) => t.favId === fav.id);
      const classes = ['fav', tab && 'open', tab && tab.active && 'active'].filter(Boolean).join(' ');
      const node = el('button', {
        class: classes,
        title: fav.title,
        'aria-label': fav.title,
        onclick: () => send('openFavorite', { spaceId: space.id, favId: fav.id }),
        onauxclick: (e) => { if (e.button === 1 && tab) send('closeTab', { tabId: tab.id }); },
      }, favicon(tab ? tab.favIconUrl || fav.favIconUrl : fav.favIconUrl, fav.title));
      node.menuTarget = { kind: 'fav', spaceId: space.id, favId: fav.id, tabId: tab ? tab.id : null };
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
    // Vue scindée de Firefox : les deux onglets côte à côte, sur une seule ligne.
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

  // Navigation au clavier : un seul élément de la liste reçoit Tab (« roving tabindex »).
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

// Multi-sélection : c'est celle de Firefox (onglets « surlignés »), partagée avec
// ses propres raccourcis et avec le clic droit d'Arbalète.
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
  // Clic simple : active l'onglet et vide la sélection.
  if (selected.length) return send('highlight', { tabIds: [tab.id] });
  return send('activateTab', { tabId: tab.id });
}

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
    favicon(tab.favIconUrl, tab.title),
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
        ondblclick: () => send('editSpace', { spaceId: s.id }),
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
      }, spaceIcon(s));
      dot.style.setProperty('--dot', s.color);
      dot.menuTarget = { kind: 'space', spaceId: s.id };
      return dot;
    }),
    el('button', {
      class: 'space-dot add',
      title: t('newSpace'),
      'aria-label': t('newSpace'),
      onclick: async () => {
        const spaceId = await send('createSpace');
        send('editSpace', { spaceId });
      },
    }, icon('plus'))
  );
}

// --- Glisser-déposer ----------------------------------------------------------------

const isTabDrag = (e) => e.dataTransfer.types.includes('application/x-arbalete-tab');
function draggedTab(e) {
  const raw = e.dataTransfer.getData('application/x-arbalete-tab');
  return raw ? Number(raw) : null;
}

const favBox = $('#favorites');
favBox.addEventListener('dragover', (e) => {
  if (!isTabDrag(e)) return;
  e.preventDefault();
  favBox.classList.add('drop-target');
});
favBox.addEventListener('dragleave', () => favBox.classList.remove('drop-target'));
favBox.addEventListener('drop', (e) => {
  favBox.classList.remove('drop-target');
  const tabId = draggedTab(e);
  if (tabId == null) return;
  e.preventDefault();
  send('addFavorite', { tabId });
});

// --- Clic droit : vrai menu Firefox, qui peut sortir de la barre --------------------

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

// --- Pied de barre -----------------------------------------------------------------

function initSidebar() {
  $('#new-tab').append(icon('plus'), el('span', { class: 'label' }, t('newTab')));
  $('#new-tab').addEventListener('click', () => send('newTab'));
  $('#settings-button').append(icon('settings'));
  $('#settings-button').addEventListener('click', () => send('openSettings'));

  // Bouton déplier / replier (comme le « Replier » de nombreuses applis web) : visible quand l'élargissement au
  // survol est activé (ou quand la barre est restée dépliée).
  const pin = $('#pin-button');
  let pinned = false;
  const updatePin = async () => {
    const s = await browser.storage.local.get(['expandOnHover', 'pinnedOpen']);
    pinned = !!s.pinnedOpen;
    pin.hidden = !s.expandOnHover && !pinned;
    pin.replaceChildren(icon(pinned ? 'panel-left-close' : 'panel-left-open'));
    pin.title = t(pinned ? 'pinCollapse' : 'pinExpand');
    pin.setAttribute('aria-label', pin.title);
    pin.setAttribute('aria-pressed', String(pinned));
  };
  pin.addEventListener('click', () => browser.storage.local.set({ pinnedOpen: !pinned }));
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.expandOnHover || changes.pinnedOpen)) updatePin();
  });
  updatePin();

  // Barre large = userChrome.css pas encore installé : on propose de le faire.
  browser.storage.local.get(['setupDone', 'setupDismissed', 'pinnedOpen']).then((s) => {
    if (s.setupDone || s.setupDismissed || s.pinnedOpen || window.innerWidth <= 120) return;
    $('#setup-banner').hidden = false;
  });
  $('#banner-setup').addEventListener('click', () => {
    $('#setup-banner').hidden = true;
    send('openSetup');
  });
  $('#banner-later').addEventListener('click', () => {
    $('#setup-banner').hidden = true;
    browser.storage.local.set({ setupDismissed: true });
  });

  // Molette : glisser horizontalement (ou Maj+molette) change d'espace, comme dans Arc.
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

let toastTimer = null;
function toast(text) {
  const box = $('#toast');
  box.textContent = text;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 1800);
}

// --- Fenêtre « modifier l'espace » --------------------------------------------------

// Recherche en français : quelques mots courants traduits vers les mots-clés anglais de Lucide.
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
let selectedIcon = null;

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
      class: name === selectedIcon ? 'icon-choice selected' : 'icon-choice',
      title: name,
      onclick: () => selectIcon(name),
    }, icon(name))),
    matches.length > shown.length ? el('div', { class: 'more' }, t('moreIcons', matches.length - shown.length)) : null,
    matches.length ? null : el('div', { class: 'more' }, t('noIcons')),
  );
}

function selectIcon(name) {
  selectedIcon = name;
  $('#f-icon-preview').replaceChildren(icon(name));
  for (const b of document.querySelectorAll('.icon-choice')) b.classList.toggle('selected', b.title === name);
}

async function initEditForm() {
  const space = state.spaces.find((s) => s.id === params.get('edit'));
  if (!space) return window.close();
  document.title = t('spaceWindowTitle', space.name);
  $('#space-form').hidden = false;
  $('#f-name').value = space.name;
  $('#f-color').value = space.color;
  selectedIcon = space.icon && space.icon.startsWith('lucide:') ? space.icon.slice(7) : 'sparkles';
  selectIcon(selectedIcon);

  const select = $('#f-container');
  select.replaceChildren(
    el('option', { value: '' }, t('containerNone')),
    ...state.containers.map((c) => el('option', { value: c.id }, c.name)),
    el('option', { value: '__new__' }, t('containerCreate'))
  );
  select.value = state.containers.some((c) => c.id === space.cookieStoreId) ? space.cookieStoreId : '';
  select.addEventListener('change', () => { $('#f-new-container-row').hidden = select.value !== '__new__'; });
  $('#f-new-container').value = space.name;
  $('#f-delete').disabled = state.spaces.length < 2;

  let searchTimer = null;
  $('#f-icon-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderIconGrid, 120);
  });
  await renderIconGrid();
  $('#f-name').select();

  $('#f-cancel').addEventListener('click', () => window.close());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });

  $('#f-delete').addEventListener('click', async () => {
    if (!confirm(t('confirmDeleteSpace', space.name))) return;
    await send('deleteSpace', { spaceId: space.id });
    window.close();
  });

  $('#space-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    let cookieStoreId = select.value || null;
    let containerName = null;
    if (cookieStoreId === '__new__') {
      containerName = $('#f-new-container').value.trim() || $('#f-name').value.trim();
      const created = await browser.contextualIdentities.create({ name: containerName, color: 'purple', icon: 'circle' });
      cookieStoreId = created.cookieStoreId;
    } else if (cookieStoreId) {
      containerName = state.containers.find((c) => c.id === cookieStoreId).name;
    }
    await send('saveSpace', {
      space: {
        id: space.id,
        icon: `lucide:${selectedIcon}`,
        name: $('#f-name').value.trim() || t('spaceFallbackName'),
        color: $('#f-color').value,
        cookieStoreId,
        containerName,
      },
    });
    window.close();
  });
}

// --- Fenêtre « modifier le groupe » --------------------------------------------------


async function initGroupForm() {
  const groupId = Number(params.get('group'));
  const group = await browser.tabGroups.get(groupId).catch(() => null);
  if (!group) return window.close();
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

  $('#g-cancel').addEventListener('click', () => window.close());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
  $('#group-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await browser.tabGroups.update(groupId, { title: $('#g-title').value.trim(), color });
    window.close();
  });
}

// --- Fenêtre « réglages » ----------------------------------------------------------

function initSettings() {
  document.title = t('settings');
  $('#settings-panel').hidden = false;
  $('#s-new-space').addEventListener('click', async () => {
    const spaceId = await send('createSpace');
    await send('editSpace', { spaceId });
    window.close();
  });
  $('#s-clear').addEventListener('click', async () => {
    await send('clearSpace', { spaceId: state.activeSpaceId });
    toast(t('tabsClosed'));
  });
  $('#s-export').addEventListener('click', exportSpaces);
  $('#s-import').addEventListener('click', () => $('#import-file').click());
  $('#s-setup').addEventListener('click', () => send('openSetup'));
  const expand = $('#s-expand');
  browser.storage.local.get('expandOnHover').then((s) => { expand.checked = !!s.expandOnHover; });
  expand.addEventListener('change', () => {
    browser.storage.local.set({ expandOnHover: expand.checked });
    toast(t(expand.checked ? 'expandOn' : 'expandOff'));
  });
  if (browser.commands.openShortcutSettings) {
    $('#s-shortcuts').addEventListener('click', () => browser.commands.openShortcutSettings());
  } else {
    $('#s-shortcuts').hidden = true;
  }
  $('#import-file').addEventListener('change', importSpaces);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
}

// --- Fenêtre « une seule barre » : installe userChrome.css ---------------------------

// L'installateur Windows est un .cmd qui contient son propre script PowerShell et le
// CSS : cmd lance PowerShell, qui relit le fichier et exécute la partie après le
// repère PS1 (les repères sont écrits en deux morceaux pour ne pas se trouver eux-mêmes).
// Le CSS est rangé entre deux commentaires repères dans userChrome.css, ce qui
// préserve les personnalisations existantes et permet de relancer l'installateur.
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

// Messages de l'installateur, en variables PowerShell (apostrophes doublées).
function installerMessages() {
  const ps = (text) => `'${text.replace(/'/g, "''")}'`;
  return [
    `$msgNoFirefox = ${ps(t('installerNoFirefox'))}`,
    `$msgProfileDone = ${ps(t('installerProfileDone'))}`,
    `$msgDone = ${ps(t('installerDone'))}`,
    `$msgNoProfile = ${ps(t('installerNoProfile'))}`,
    '',
  ].join('\r\n');
}

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
  const { os } = await browser.runtime.getPlatformInfo();
  if (os !== 'win') {
    $('#setup-windows').hidden = true;
    $('#setup-manual').open = true;
  }
  $('#setup-download-script').addEventListener('click', async () => {
    const batch = [
      '@echo off',
      `echo ${t('installerRunning')}`,
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
}

async function exportSpaces() {
  const data = await send('exportSpaces');
  const blob = new Blob([JSON.stringify({ arbalete: 1, spaces: data }, null, 2)], { type: 'application/json' });
  const link = el('a', { href: URL.createObjectURL(blob), download: t('exportFileName') });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

async function importSpaces(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!confirm(t('confirmImport', parsed.spaces.length))) return;
    await send('importSpaces', { spaces: parsed.spaces });
    toast(t('spacesImported'));
  } catch (err) {
    toast(t('fileNotRecognized'));
  }
}

// --- Synchronisation avec le script de fond ---------------------------------------

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

// Textes de la page : data-i18n (texte), data-i18n-title, data-i18n-placeholder, data-i18n-label.
function applyI18n() {
  document.documentElement.lang = browser.i18n.getUILanguage();
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle);
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of document.querySelectorAll('[data-i18n-label]')) node.setAttribute('aria-label', t(node.dataset.i18nLabel));
}

(async () => {
  applyI18n();
  document.body.classList.add(`mode-${mode}`);
  windowId = mode === 'sidebar' ? (await browser.windows.getCurrent()).id : Number(params.get('win'));
  await refresh();
  if (mode === 'sidebar') initSidebar();
  else if (mode === 'edit') await initEditForm();
  else if (mode === 'group') await initGroupForm();
  else if (mode === 'setup') await initSetup();
  else initSettings();
})();
