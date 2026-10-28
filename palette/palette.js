'use strict';

// Dans le calque, la palette est un cadre d'extension posé dans une page web : Firefox
// ne lui donne qu'une partie des API (pas commands, history…). Tout ce qui demande des
// droits passe donc par le script de fond (send).
//
// Recherche rapide d'Arbalète (façon barre de commande d'Arc) : onglets de tous les
// espaces de la fenêtre, favoris, commandes, historique (si autorisé dans les
// réglages), adresse à ouvrir et recherche sur le Web. Entrée lance, Échap ferme.
// « > » au début ne cherche que dans les commandes.

const $ = (sel) => document.querySelector(sel);
const t = (key, ...subs) => browser.i18n.getMessage(key, subs.map(String)) || key;
const SVG_NS = 'http://www.w3.org/2000/svg';

// overlay : cadre centré dans la page (overlay.js) ; panel : panneau sous l'icône
// d'Arbalète, pour les pages où Firefox interdit toute extension.
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
const spaceOf = (id) => state.spaces.find((s) => s.id === id);
const activeTab = () => state.tabs.find((x) => x.active);

function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return url;
  }
}

// Tous les mots tapés doivent apparaître ; le titre compte plus que l'adresse.
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

// --- Commandes -----------------------------------------------------------------------------

function commands() {
  const tab = activeTab();
  const list = [
    { label: t('paletteNewTab'), icon: 'plus', run: () => send('newTab') },
    { label: t('paletteNewSpace'), icon: 'layers', run: async () => send('editSpace', { spaceId: await send('createSpace') }) },
    { label: t('paletteSplit'), icon: 'columns-2', run: () => tab && send('tabAction', { tabId: tab.id, action: 'split' }) },
    { label: t('paletteCopyUrl'), icon: 'link', run: () => tab && send('tabAction', { tabId: tab.id, action: 'copyurl' }) },
    { label: t('paletteDuplicate'), icon: 'copy', run: () => tab && send('tabAction', { tabId: tab.id, action: 'duplicate' }) },
    { label: t('paletteCloseDuplicates'), icon: 'copy-x', run: () => tab && send('tabAction', { tabId: tab.id, action: 'closedupes' }) },
    { label: t('paletteClearSpace'), icon: 'eraser', run: () => send('clearSpace', { spaceId: state.activeSpaceId }) },
    { label: t('paletteReopenClosed'), icon: 'undo-2', run: () => send('reopenClosed') },
    { label: t('paletteSettings'), icon: 'settings', run: () => send('openSettings') },
  ];
  for (const space of state.spaces) {
    if (space.id !== state.activeSpaceId) {
      list.push({ label: t('paletteGoToSpace', space.name), icon: spaceIconName(space), run: () => send('switchSpace', { spaceId: space.id }) });
      if (tab && !tab.pinned) {
        list.push({ label: t('paletteMoveTabToSpace', space.name), icon: 'arrow-right-left', run: () => send('moveTab', { tabId: tab.id, spaceId: space.id }) });
      }
    }
  }
  list.push({ label: t('paletteShortcuts'), icon: 'keyboard', run: () => send('openShortcuts') });
  return list.map((c) => ({ ...c, kind: 'command', section: t('paletteSectionCommands') }));
}

// --- Recherche -------------------------------------------------------------------------------

function tabResult(tab) {
  const space = spaceOf(tab.spaceId);
  return {
    kind: 'tab',
    section: t('paletteSectionTabs'),
    label: tab.title || tab.url,
    sub: host(tab.url),
    favicon: tab.favIconUrl,
    badge: space ? { icon: spaceIconName(space), text: space.name } : null,
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
    // Sans recherche : derniers onglets utilisés, puis quelques commandes.
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
          badge: { icon: spaceIconName(space), text: space.name },
          run: () => send('openFavorite', { spaceId: space.id, favId: fav.id }),
        });
      }
    }
    list.push(...scored(favorites).slice(0, 5));
  }
  list.push(...scored(commands()).slice(0, commandsOnly ? 30 : 4));

  if (!commandsOnly) {
    const web = { kind: 'web', section: t('paletteSectionWeb'), label: t('paletteSearchWeb', text), icon: 'search', run: () => send('webSearch', { text }) };
    // Rien de précis (onglet, favori, commande) : la recherche Web passe en tête, Entrée la lance.
    const precise = list.some((r) => r.kind !== 'open');
    if (precise) list.push(web);
    else list.splice(list[0] && list[0].kind === 'open' ? 1 : 0, 0, web);
  }
  show(list, id);
  if (commandsOnly) return;

  // Suggestions du moteur de recherche (réglage) et historique (permission), ajoutés
  // juste après la recherche Web dès qu'ils arrivent.
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

// --- Affichage et clavier ----------------------------------------------------------------------

function show(list, id) {
  if (id !== searchId) return; // une frappe plus récente a pris le relais
  results = list;
  selected = Math.min(selected, Math.max(0, list.length - 1));
  const rows = [];
  let section = null;
  list.forEach((r, i) => {
    if (r.section !== section) {
      section = r.section;
      rows.push(el('li', { class: 'section', role: 'presentation' }, section));
    }
    const visual = el('span', { class: 'visual' }, r.favicon
      ? el('img', { src: r.favicon, alt: '', onerror: (e) => e.target.replaceWith(icon('globe')) })
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
      r.badge ? el('span', { class: 'badge' }, [icon(r.badge.icon), r.badge.text]) : null,
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
  if (state) safeSearch(e.target.value); // sinon, le chargement lancera la recherche
});

// Une erreur de recherche s'affiche dans la palette au lieu de la laisser vide.
function safeSearch(query) {
  search(query).catch((error) => {
    $('#results').replaceChildren(el('li', { class: 'section' }, `Arbalète : ${error && error.message ? error.message : error}`));
  });
}

// Fenêtre de la palette. Dans le calque, la palette est un cadre posé sur une page web :
// on passe par l'onglet qui l'héberge, plus fiable que windows.getCurrent() dans ce cas.
async function currentWindowId() {
  try {
    const tab = await browser.tabs.getCurrent();
    if (tab) return tab.windowId;
  } catch (e) {
    // pas d'onglet (panneau de la barre d'outils)
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

// Focus immédiat dans le champ, et à chaque fois que le cadre reçoit le focus.
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
    if (!state || !state.tabs) throw new Error('état vide');
  } catch (error) {
    $('#results').replaceChildren(el('li', { class: 'section' }, `Arbalète : ${error && error.message ? error.message : error}`));
    return;
  }
  const space = state.spaces.find((x) => x.id === state.activeSpaceId);
  if (space) document.documentElement.style.setProperty('--accent', space.color);

  // Le calque ajuste la hauteur de son cadre au contenu.
  if (mode === 'overlay') {
    new ResizeObserver(() => {
      window.parent.postMessage({ from: 'arbalete-palette', type: 'arbalete-palette-height', height: document.body.scrollHeight }, '*');
    }).observe(document.body);
    window.addEventListener('blur', () => setTimeout(() => { if (!document.hasFocus()) close(); }, 150));
  }
  safeSearch($('#query').value);
  focusQuery();
})();
