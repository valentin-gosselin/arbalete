'use strict';

// In the overlay, the palette is an extension frame placed in a web page: Firefox
// only gives it part of the APIs (no commands, history...). Everything that needs
// rights therefore goes through the background script (send).
//
// Arbalète quick search (like Arc's command bar): tabs of all the spaces of the
// window, favorites, commands, history (if allowed in the settings), address to open
// and Web search. Enter launches, Esc closes.
// A leading ">" only searches in the commands.

const $ = (sel) => document.querySelector(sel);
const t = (key, ...subs) => browser.i18n.getMessage(key, subs.map(String)) || key;
const SVG_NS = 'http://www.w3.org/2000/svg';

// overlay: frame centered in the page (overlay.js); panel: panel under the Arbalète
// icon, for pages where Firefox forbids every extension.
const params = new URLSearchParams(location.search);
const mode = params.has('overlay') ? 'overlay' : 'panel';

let windowId = null;
let state = null;
let results = [];
let selected = 0;
let searchId = 0;

function close() {
  if (mode === 'overlay') window.parent.postMessage({ from: 'arbalete-palette', type: 'arbalete-palette-close' }, '*');
  else window.close();
}

const send = (type, data = {}) => browser.runtime.sendMessage({ type, windowId, ...data });

// Settings from quick search: the panel turns into the dialog itself; the overlay is
// replaced by the dialog's overlay.
function openDialog(query) {
  if (mode === 'panel') location.replace(`../sidebar/sidebar.html?${query}&win=${windowId}&panel=1`);
  else send('openDialog', { query });
}
const normalize = (text) => (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

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

const spaceIconName = (space) => (space && space.icon && space.icon.startsWith('lucide:') ? space.icon.slice(7) : 'layers');
// Imported space icon (data URL), shown instead of the Lucide one.
const spaceImage = (space) => (space && space.icon === 'image' && space.iconImage) || null;
const spaceBadge = (space) => (space ? { icon: spaceIconName(space), image: spaceImage(space), text: space.name } : null);
const spaceOf = (id) => state.spaces.find((s) => s.id === id);
const activeTab = () => state.tabs.find((x) => x.active);

function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return url;
  }
}

// All typed words must appear; the title counts more than the address.
function score(words, title, url) {
  const nt = normalize(title);
  const nu = normalize(url);
  let total = 0;
  for (const w of words) {
    if (nt.startsWith(w)) total += 4;
    else if (nt.includes(w)) total += 3;
    else if (nu.includes(w)) total += 1;
    else return 0;
  }
  return total;
}

function looksLikeUrl(text) {
  return /^[a-z]+:\/\//i.test(text) || /^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(text);
}

// --- Commands ----------------------------------------------------------------

function commands() {
  const tab = activeTab();
  const list = [
    { label: t('paletteNewTab'), icon: 'plus', run: () => send('newTab') },
    { label: t('paletteNewSpace'), icon: 'layers', run: async () => send('editSpace', { spaceId: await send('createSpace') }) },
    { label: t('paletteSplit'), icon: 'columns-2', run: () => tab && send('tabAction', { tabId: tab.id, action: 'split' }) },
    { label: t('paletteCopyUrl'), icon: 'link', run: () => tab && send('tabAction', { tabId: tab.id, action: 'copyurl' }) },
    { label: t('paletteArchiveTab'), icon: 'archive', run: () => tab && send('tabAction', { tabId: tab.id, action: 'archive' }) },
    { label: t('paletteDuplicate'), icon: 'copy', run: () => tab && send('tabAction', { tabId: tab.id, action: 'duplicate' }) },
    { label: t('paletteCloseDuplicates'), icon: 'copy-x', run: () => tab && send('tabAction', { tabId: tab.id, action: 'closedupes' }) },
    { label: t('paletteClearSpace'), icon: 'eraser', run: () => send('clearSpace', { spaceId: state.activeSpaceId }) },
    { label: t('paletteReopenClosed'), icon: 'undo-2', run: () => send('reopenClosed') },
    { label: t('paletteSettings'), icon: 'settings', run: () => openDialog('settings=1') },
  ];
  for (const space of state.spaces) {
    if (space.id !== state.activeSpaceId) {
      list.push({ label: t('paletteGoToSpace', space.name), icon: spaceIconName(space), image: spaceImage(space), run: () => send('switchSpace', { spaceId: space.id }) });
      if (tab && !tab.pinned) {
        list.push({ label: t('paletteMoveTabToSpace', space.name), icon: 'arrow-right-left', run: () => send('moveTab', { tabId: tab.id, spaceId: space.id }) });
      }
    }
  }
  list.push({ label: t('paletteShortcuts'), icon: 'keyboard', run: () => send('openShortcuts') });
  return list.map((c) => ({ ...c, kind: 'command', section: t('paletteSectionCommands') }));
}

// --- Search ------------------------------------------------------------------

function tabResult(tab) {
  const space = spaceOf(tab.spaceId);
  return {
    kind: 'tab',
    section: t('paletteSectionTabs'),
    label: tab.title || tab.url,
    sub: host(tab.url),
    favicon: tab.favIconUrl,
    badge: spaceBadge(space),
    url: tab.url,
    run: () => send('activateTab', { tabId: tab.id }),
  };
}

async function search(query) {
  const id = ++searchId;
  const text = query.trim();
  const commandsOnly = text.startsWith('>');
  const words = normalize(commandsOnly ? text.slice(1) : text).split(/\s+/).filter(Boolean);
  const list = [];

  if (!words.length && !commandsOnly) {
    // With no query: most recently used tabs, then a few commands.
    const recent = state.tabs.filter((x) => !x.active && /^(https?|file|moz-extension):/.test(x.url))
      .sort((a, b) => b.lastAccessed - a.lastAccessed).slice(0, 6);
    list.push(...recent.map((x) => ({ ...tabResult(x), section: t('paletteSectionRecent') })));
    list.push(...commands().slice(0, 4));
    return show(list, id);
  }

  const scored = (items) => items.map((r) => ({ r, s: score(words, r.label, r.url || '') }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.r);

  if (!commandsOnly) {
    if (looksLikeUrl(text)) {
      const url = /^[a-z]+:\/\//i.test(text) ? text : `https://${text}`;
      list.push({ kind: 'open', section: t('paletteSectionWeb'), label: t('paletteOpenUrl', url), icon: 'globe', run: () => send('newTab', { url }) });
    }
    list.push(...scored(state.tabs.filter((x) => !x.active).map(tabResult)).slice(0, 8));
    const favorites = [];
    for (const space of state.spaces) {
      for (const fav of space.favorites) {
        favorites.push({
          kind: 'favorite',
          section: t('paletteSectionFavorites'),
          label: fav.title,
          sub: host(fav.url),
          favicon: fav.favIconUrl,
          url: fav.url,
          badge: spaceBadge(space),
          run: () => send('openFavorite', { spaceId: space.id, favId: fav.id }),
        });
      }
    }
    for (const fav of state.shared || []) {
      favorites.push({
        kind: 'favorite',
        section: t('paletteSectionFavorites'),
        label: fav.title,
        sub: host(fav.url),
        favicon: fav.favIconUrl,
        url: fav.url,
        badge: { icon: 'layers', text: t('sharedFavorite') },
        run: () => send('openFavorite', { spaceId: state.activeSpaceId, favId: fav.id }),
      });
    }
    list.push(...scored(favorites).slice(0, 5));

    // Tabs stored in the spaces' archive (automatic cleanup).
    const archive = await send('getArchive').catch(() => ({}));
    if (id !== searchId) return;
    const archived = [];
    for (const [spaceId, entries] of Object.entries(archive || {})) {
      const space = spaceOf(spaceId);
      for (const x of entries) {
        archived.push({
          kind: 'archived',
          section: t('paletteSectionArchive'),
          label: x.title,
          sub: host(x.url),
          favicon: x.favIconUrl,
          url: x.url,
          badge: spaceBadge(space),
          run: () => send('reopenArchived', { spaceId, url: x.url }),
        });
      }
    }
    list.push(...scored(archived).slice(0, 5));
  }
  list.push(...scored(commands()).slice(0, commandsOnly ? 30 : 4));

  if (!commandsOnly) {
    const web = { kind: 'web', section: t('paletteSectionWeb'), label: t('paletteSearchWeb', text), icon: 'search', run: () => send('webSearch', { text }) };
    // Nothing specific (tab, favorite, command): Web search comes first, Enter launches it.
    const precise = list.some((r) => r.kind !== 'open');
    if (precise) list.push(web);
    else list.splice(list[0] && list[0].kind === 'open' ? 1 : 0, 0, web);
  }
  show(list, id);
  if (commandsOnly) return;

  // Suggestions from the search engine (setting) and history (permission), added
  // right after the Web search as soon as they arrive.
  const [suggestions, visits] = await Promise.all([
    send('suggest', { text }).catch(() => []),
    send('searchHistory', { text }).catch(() => []),
  ]);
  if (id !== searchId) return;
  const extra = (suggestions || []).filter((x) => normalize(x) !== normalize(text)).slice(0, 5).map((x) => ({
    kind: 'suggest',
    section: t('paletteSectionSuggestions'),
    label: x,
    icon: 'search',
    run: () => send('webSearch', { text: x }),
  }));
  const known = new Set(list.map((r) => r.url).filter(Boolean));
  const history = (visits || []).filter((v) => !known.has(v.url)).slice(0, 6).map((v) => ({
    kind: 'history',
    section: t('paletteSectionHistory'),
    label: v.title || v.url,
    sub: host(v.url),
    icon: 'clock',
    url: v.url,
    run: () => send('newTab', { url: v.url }),
  }));
  if (!extra.length && !history.length) return;
  list.splice(list.findIndex((r) => r.kind === 'web') + 1, 0, ...extra, ...history);
  show(list, id);
}

// --- Display and keyboard ----------------------------------------------------

function show(list, id) {
  if (id !== searchId) return; // a more recent keystroke took over
  results = list;
  selected = Math.min(selected, Math.max(0, list.length - 1));
  const rows = [];
  let section = null;
  list.forEach((r, i) => {
    if (r.section !== section) {
      section = r.section;
      rows.push(el('li', { class: 'section', role: 'presentation' }, section));
    }
    const picture = r.favicon || r.image;
    const visual = el('span', { class: 'visual' }, picture
      ? el('img', { src: picture, alt: '', onerror: (e) => e.target.replaceWith(icon('globe')) })
      : icon(r.icon || 'globe'));
    rows.push(el('li', {
      class: i === selected ? 'item selected' : 'item',
      role: 'option',
      id: `result-${i}`,
      'aria-selected': String(i === selected),
      onmousemove: () => select(i),
      onclick: () => run(i),
    }, [
      visual,
      el('div', { class: 'text' }, [
        el('span', { class: 'title' }, r.label),
        r.sub ? el('span', { class: 'sub' }, r.sub) : null,
      ]),
      r.badge ? el('span', { class: 'badge' }, [r.badge.image ? el('img', { class: 'ic', src: r.badge.image, alt: '' }) : icon(r.badge.icon), r.badge.text]) : null,
      el('span', { class: 'enter', 'aria-hidden': 'true' }, '↵'),
    ]));
  });
  $('#results').replaceChildren(...rows);
  $('#query').setAttribute('aria-activedescendant', results.length ? `result-${selected}` : '');
}

function select(i) {
  if (i === selected || i < 0 || i >= results.length) return;
  selected = i;
  for (const node of document.querySelectorAll('.item')) {
    const on = node.id === `result-${i}`;
    node.classList.toggle('selected', on);
    node.setAttribute('aria-selected', String(on));
    if (on) node.scrollIntoView({ block: 'nearest' });
  }
  $('#query').setAttribute('aria-activedescendant', `result-${i}`);
}

async function run(i) {
  const r = results[i];
  if (!r) return;
  await r.run();
  close();
}

$('#query').addEventListener('input', (e) => {
  selected = 0;
  if (state) safeSearch(e.target.value); // otherwise, the load will start the search
});

// A search error is shown in the palette instead of leaving it empty.
function safeSearch(query) {
  search(query).catch((error) => {
    $('#results').replaceChildren(el('li', { class: 'section' }, `Arbalète : ${error && error.message ? error.message : error}`));
  });
}

// Palette window. In the overlay, the palette is a frame placed on a web page:
// we go through the tab that hosts it, more reliable than windows.getCurrent() here.
async function currentWindowId() {
  try {
    const tab = await browser.tabs.getCurrent();
    if (tab) return tab.windowId;
  } catch (e) {
    // no tab (toolbar panel)
  }
  try {
    return (await browser.windows.getCurrent()).id;
  } catch (e) {
    return (await browser.windows.getLastFocused()).id;
  }
}

$('#query').addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowDown': select(selected + 1); break;
    case 'ArrowUp': select(selected - 1); break;
    case 'PageDown': select(Math.min(results.length - 1, selected + 6)); break;
    case 'PageUp': select(Math.max(0, selected - 6)); break;
    case 'Enter': run(selected); break;
    case 'Escape': close(); break;
    default: return;
  }
  e.preventDefault();
});

// Immediate focus in the field, and every time the frame receives focus.
const focusQuery = () => $('#query').focus();
focusQuery();
window.addEventListener('focus', focusQuery);
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'arbalete-palette-focus') focusQuery();
});

(async () => {
  document.documentElement.lang = browser.i18n.getUILanguage();
  $('#query').placeholder = t('palettePlaceholder');
  $('#query').setAttribute('aria-label', t('palettePlaceholder'));
  $('#hints').append(
    el('span', {}, [el('kbd', {}, '↑↓'), ` ${t('paletteHintMove')}`]),
    el('span', {}, [el('kbd', {}, '↵'), ` ${t('paletteHintOpen')}`]),
    el('span', {}, [el('kbd', {}, '>'), ` ${t('paletteHintCommands')}`]),
  );
  document.body.classList.add(`mode-${mode}`);
  try {
    windowId = params.get('win') ? Number(params.get('win')) : await currentWindowId();
    state = await send('getState');
    if (!state || !state.tabs) throw new Error('empty state');
  } catch (error) {
    $('#results').replaceChildren(el('li', { class: 'section' }, `Arbalète : ${error && error.message ? error.message : error}`));
    return;
  }
  const space = state.spaces.find((x) => x.id === state.activeSpaceId);
  if (space) document.documentElement.style.setProperty('--accent', space.color);

  // The overlay adjusts its frame's height to the content.
  if (mode === 'overlay') {
    new ResizeObserver(() => {
      window.parent.postMessage({ from: 'arbalete-palette', type: 'arbalete-palette-height', height: document.body.scrollHeight }, '*');
    }).observe(document.body);
    window.addEventListener('blur', () => setTimeout(() => { if (!document.hasFocus()) close(); }, 150));
  }
  safeSearch($('#query').value);
  focusQuery();
})();
