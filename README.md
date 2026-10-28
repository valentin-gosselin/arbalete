# Arbalète

**Arc-style spaces for Firefox**, in a compact sidebar. *Arbalète* is French for crossbow, a nod to Arc.

Version française : [LISEZMOI.md](LISEZMOI.md).

## Features

- **Spaces**: each space has its own tabs, favorites, color, icon and optionally its own Firefox container (separate logins). Switching spaces hides the other spaces' tabs in the same window, no extra windows.
- **Switch spaces** with the icons at the bottom, a horizontal swipe or Shift+wheel anywhere in the sidebar, or Alt+1 to Alt+5 and Alt+Shift+Up/Down.
- **Favorites**: tiles at the top of each space, like Arc's pinned tabs.
- **Auto-archive**: per space, tabs inactive for 12 h, 24 h or 7 days go to the space archive (sidebar button and quick search), kept 30 days.
- **Quick search** (Alt+K): tabs of all spaces, favorites, archive, commands, history, web search with your engine's suggestions.
- **Split view**: two sites side by side in one tab.
- **Tab groups**: Firefox tab groups are shown with their color, can be collapsed, renamed, ungrouped or moved to another space.
- **Right-click** opens Firefox's own tab menu, plus Arbalète actions (favorites, move to space, groups).
- **Compact mode**: icons only, titles as tooltips. Optional expand on hover, and a button to keep the sidebar expanded.
- **A single sidebar**: a small userChrome.css (installed from the extension settings, no admin rights needed) hides Firefox's own tabs while Arbalète is open.
- **Sync**: spaces and favorites follow you through Firefox Sync, or through an export file.
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

MIT, see [LICENSE](LICENSE).
