# addons.mozilla.org listing

Everything needed for the public (listed) page of Arbalète on addons.mozilla.org.
Build the listed package with `sh build.sh listed` (or `powershell -File build.ps1 -Listed`):
it has no `update_url`, which AMO refuses on listed versions.

## Fields

| Field | Value |
|---|---|
| Name | Arbalète |
| Add-on URL | `arbalete` |
| Categories | Tabs, Appearance |
| Tags | container (AMO only accepts its own fixed list; privacy also fits) |
| Homepage | https://github.com/valentin-gosselin/arbalete |
| Support site | https://github.com/valentin-gosselin/arbalete/issues |
| License | Mozilla Public License 2.0 |
| Privacy policy | the content of `PRIVACY.md` |
| Icon | `icon-128.png` (also in the package as `icons/arbalete.svg`) |
| Firefox | 142 and later |

## Summary (250 characters max)

**fr**: Des espaces façon Arc dans Firefox : chaque espace a ses onglets, ses favoris, sa couleur et ses comptes séparés. Barre latérale compacte, recherche rapide Alt+K, vue scindée et archive automatique des onglets.

**en**: Arc-style spaces for Firefox: each space has its own tabs, favorites, color and separate logins. Compact vertical sidebar, Alt+K quick search, split view and automatic tab archive.

## Description (fr)

AMO uses a limited Markdown in this field.

```markdown
**Arbalète** range vos onglets en **espaces**, comme le navigateur Arc, sans quitter Firefox. Un espace pour le perso, un pour le travail, un par projet : chacun garde ses onglets, ses favoris, sa couleur, son icône et, si vous voulez, son propre conteneur (comptes connectés séparés). Changer d'espace masque les onglets des autres, dans la même fenêtre.

**Espaces**

- Barre latérale verticale et compacte, qui peut se déployer au survol. Un petit installateur (Windows, Linux, macOS) masque les onglets natifs de Firefox quand la barre est ouverte.
- Favoris en tuiles, propres à un espace ou communs à tous.
- Sites d'un espace : un lien vers vos sites de travail (l'étoile est acceptée, dev.\*.exemple.fr) rejoint tout seul le bon espace et son conteneur.
- Bascule horaire : des créneaux par jour (du lundi au vendredi de 9 h à 18 h, par exemple) pour passer automatiquement sur un espace.
- Une couleur, un fond de barre (uni, dégradé ou sans), une icône parmi 1 900 ou votre propre image.

**Onglets**

- Recherche rapide (Alt+K) : onglets de tous les espaces, favoris, archive, commandes, historique et recherche sur le Web.
- Vue scindée : deux sites côte à côte dans un seul onglet.
- Archive automatique des onglets inactifs (après 12 h, 24 h ou 7 jours), réouverture en un clic.
- Groupes d'onglets, sélection multiple, menu d'onglet de Firefox, clic molette pour fermer, pastilles de messages non lus.

**D'un PC à l'autre**

- Vos espaces vous suivent par Firefox Sync.
- Modèles d'espaces : exportez une sélection d'espaces et ajoutez-la chez quelqu'un d'autre.
- Un assistant de démarrage crée vos espaces en une minute.

**Vie privée** : aucune donnée collectée ni envoyée, aucun pistage. Code ouvert, licence MPL 2.0 : [github.com/valentin-gosselin/arbalete](https://github.com/valentin-gosselin/arbalete)

*Arbalète est un projet indépendant, sans lien avec The Browser Company ni avec le navigateur Arc.*
```

## Description (en)

```markdown
**Arbalète** sorts your tabs into **spaces**, like the Arc browser, without leaving Firefox. One space for personal browsing, one for work, one per project: each keeps its own tabs, favorites, color, icon and, if you like, its own container (separate logins). Switching spaces hides the other spaces' tabs, in the same window.

**Spaces**

- Compact vertical sidebar that can expand on hover. A small installer (Windows, Linux, macOS) hides Firefox's own tab strip while the sidebar is open.
- Favorites as tiles, for one space or shared by all of them.
- Space sites: a link to your work sites (wildcards work, dev.\*.example.com) joins the right space and its container by itself.
- Scheduled switching: time slots per day (Monday to Friday, 9 am to 6 pm for instance) to switch to a space automatically.
- A color, a sidebar background (plain, gradient or none), an icon among 1,900 or your own image.

**Tabs**

- Quick search (Alt+K): tabs of every space, favorites, archive, commands, history and web search.
- Split view: two sites side by side in a single tab.
- Automatic archive of inactive tabs (after 12 h, 24 h or 7 days), reopened in one click.
- Tab groups, multi-selection, Firefox's tab menu, middle click to close, unread badges.

**Across your computers**

- Your spaces follow you through Firefox Sync.
- Space templates: export a selection of spaces and add it to someone else's.
- A first run assistant sets up your spaces in a minute.

**Privacy**: no data collected or sent, no tracking. Open source, MPL 2.0 license: [github.com/valentin-gosselin/arbalete](https://github.com/valentin-gosselin/arbalete)

*Arbalète is an independent project, not affiliated with The Browser Company or the Arc browser.*
```

## Notes to reviewers

```text
Source: the package is the plain source, no build step, no minified or bundled code.
Repository: https://github.com/valentin-gosselin/arbalete

Test: install, the sidebar opens with a first run assistant tab. Alt+K opens quick
search. Double-click a space icon at the bottom of the sidebar to edit it.

Generated installer (Settings > "Hide Firefox's own tabs"): Firefox does not let
extensions hide the native tab strip. The extension builds, locally and on the user's
click, a script from the userChrome.css shipped in the package (.cmd running PowerShell
on Windows, .sh on Linux and macOS) and offers it as a download. The user runs it
explicitly. It only writes user_pref("toolkit.legacyUserProfileCustomizations.stylesheets",
true) into user.js and the CSS into chrome/userChrome.css, in the user's own Firefox
profiles, between marker comments (other customizations are kept).

Split view (optional permissions webRequest, webRequestBlocking, browsingData,
<all_urls>, requested on first use): the extension page split/split.html shows two
sites in iframes. For sub_frame requests whose parent frame is that extension page
only (isSplitFrame in background.js), it removes X-Frame-Options and CSP
frame-ancestors from the response, and sets a Referer for the YouTube player. Before
showing YouTube it removes YouTube's service worker (browsingData, hostnames limited
to YouTube), which would otherwise block framing. split/frame.js is registered with
contentScripts.register only once the permission is granted, and reports navigation
inside those frames to the split view page.

Quick search and dialogs: palette/overlay.js is injected on demand (activeTab, or the
optional all-sites permission) into the active tab. It shows an extension page in an
iframe inside a closed shadow DOM. The web-accessible dialog page only renders when it
receives a one-time token from the background script, so a web page cannot frame it on
its own.

Network: none by default. The only request the extension makes is to a search
suggestion URL that the user types in the settings (optional, off by default),
fetched with credentials omitted, for quick search suggestions.

No remote code, no eval. data_collection_permissions: none.
```

## Screenshots

Ready in `screenshots/` (1280 × 800, English interface, sample content only), made with a
clean test profile: `01-spaces-expanded.png` to `08-archive.png`, in the order below.

| # | What to show | Caption (fr) | Caption (en) |
|---|---|---|---|
| 1 | A whole window: sidebar expanded, a space with 3 favorites and 6 tabs, colored background | Vos onglets rangés en espaces, dans une barre latérale | Your tabs sorted into spaces, in a sidebar |
| 2 | The same window, sidebar compact (icons only), a nice page displayed | Barre compacte : les icônes seules, toute la place pour la page | Compact sidebar: just icons, the page gets the room |
| 3 | Alt+K open over a page, typing a word that matches tabs from two spaces | Recherche rapide (Alt+K) dans tous les espaces | Quick search (Alt+K) across all spaces |
| 4 | Space editor: icon popover open, gradient chosen, two time slots | Couleurs, icône, sites et horaires de chaque espace | Colors, icon, sites and schedule for each space |
| 5 | Split view with two sites side by side | Vue scindée : deux sites dans un onglet | Split view: two sites in one tab |
| 6 | Settings dialog over a page | Réglages en un coup d'œil | Settings at a glance |
| 7 | First run assistant, step 1 | Un assistant pour démarrer en une minute | An assistant to get started in a minute |
| 8 | Archive window with a few tabs | Les onglets inactifs rangés tout seuls dans l'archive | Inactive tabs archived by themselves |

## After the listed version is approved

Self-distributed installs (0.11.0) check `updates.json`. Version numbers are unique across
AMO channels, so the first listed version (0.11.1) is also their next update: download the
signed listed `.xpi` from AMO and run `sh tools/release.sh <file.xpi>`. That build has no
`update_url`, so once installed Firefox follows AMO from then on.
