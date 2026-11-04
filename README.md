# Arbalète

**Arc-style spaces for Firefox**, in a compact sidebar. *Arbalète* is French for crossbow, a nod to Arc.

Version française : [LISEZMOI.md](LISEZMOI.md).

## Features

- **Spaces**: each space has its own tabs, favorites, color, icon and optionally its own Firefox container (separate logins). Switching spaces hides the other spaces' tabs in the same window, no extra windows.
- **Switch spaces** with the icons at the bottom, a horizontal swipe or Shift+wheel anywhere in the sidebar, or Alt+1 to Alt+5 and Alt+Shift+Up/Down.
- **Favorites**: tiles at the top of each space, like Arc's pinned tabs.
- **Link folders**: folders of links under the tiles, each with its name, icon and color. A link keeps its own tab, shown under the link; drag tabs, links or tiles into a folder. Like a space, a folder can claim sites (their tabs gather under it, from any space) and have its own container.
- **Auto-archive**: per space, tabs inactive for 12 h, 24 h or 7 days go to the space archive (sidebar button and quick search), kept 30 days.
- **Quick search** (Alt+K): tabs of all spaces, favorites, archive, commands, history, web search with your engine's suggestions.
- **Split view**: two sites side by side in one tab.
- **Windows**: drag a tab out of the sidebar to give it its own window, or onto the sidebar of another window to move it there (dropped on a space icon, it joins that space). Right-click a tab or a page of a secondary window or popup: "Move back to the main window".
- **Tab groups**: Firefox tab groups are shown with their color, can be collapsed, renamed, ungrouped or moved to another space.
- **Right-click** opens Firefox's own tab menu, plus Arbalète actions (favorites, move to space, groups).
- **Compact mode**: icons only, titles as tooltips. Optional expand on hover, and a button to keep the sidebar expanded.
- **A single sidebar**: a small userChrome.css (installed from the extension settings, no admin rights needed) hides Firefox's own tabs while Arbalète is open. When an update of Arbalète changes it, a button at the bottom of the sidebar offers to run the installer again.
- **Sync**: spaces and favorites follow you through Firefox Sync, or through an export file.
- **Space templates**: export a selection of spaces (with or without favorites) and add them to someone else's spaces, or move all of them to another computer.
- **First run assistant**: pick and rename starting spaces, hide Firefox's own tabs, set a few useful options.
- **Automatic updates** for self-distributed builds, through `updates.json` and GitHub releases (`sh tools/release.sh <signed.xpi>`).
- **Keyboard and screen readers**: arrow keys, Enter and Delete in the tab list, labels on every control.
- Icons by [Lucide](https://lucide.dev) (1,900+ icons, ISC license), French and English interface.

## Privacy

Arbalète collects nothing and makes no network request. See [PRIVACY.md](PRIVACY.md).

## Development

1. Open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" and pick `manifest.json`.
2. After a change, click "Reload" in the same page.
3. Translations live in `tools/messages.js`; run `node tools/messages.js` to regenerate `_locales/`.
4. Build the package for addons.mozilla.org with `powershell -File build.ps1` (a real zip with `/` paths).

Requires Firefox 142 or later.

## License

Mozilla Public License 2.0 (MPL-2.0), see [LICENSE](LICENSE). Versions up to 0.11.0 were released under the MIT license.
