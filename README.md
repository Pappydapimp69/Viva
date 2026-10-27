# PAVÉ — Paris Riot Manager

A top-down crowd-physics strategy game, built from the "Managing 100,000 People in a Paris Riot" trailer.
Lead the manif, or command the CRS. Target price on Steam: **$4.99**.

**Play in the browser:** GitHub Pages (deployed by `.github/workflows/pages.yml`).

## Features
- Tens of thousands of simulated people (up to 100k in Sandbox) with real crowd physics: flow-field pathing, pressure, panic. The crowd finds every gap.
- Two sides, seven campaign levels + sandbox:
  - ✊ **Protest** — march blocs on landmarks, infiltrate casseurs, launch fireworks at shield lines, build barricades, mobilise the group chat.
  - 🛡 **Police** — form lines that span the street automatically, charge, tear gas, steel barriers, dispatch the pompiers, call reinforcements.
- Parked cars burn and fire spreads car-to-car with the wind. 🔥 CARS BURNED counter.
- Capturable landmarks (République, Bastille, Nation…), procedurally generated Haussmann city.
- Night levels with streetlights and fire glow.
- In-game phone: the bloc's group chat or the préfecture radio reacts to what happens.
- 100% procedural art and audio — no asset files.

## Run
- Browser: open `index.html` (no build step, no server needed).
- Desktop: `npm install && npm start` (Electron).
- Tests: `npm test` (sim unit tests), `npm run smoke` (headless Chromium, needs Playwright).
- Bench: `node tools/bench.js <levelIndex> <seconds> <crowdScale> [bot]`.

## Ship to Steam
See [`steam/STORE.md`](steam/STORE.md) for the store page, pricing, achievements and the upload checklist.
`npm run dist` produces the Windows/Linux builds in `dist/`; replace `steam_appid.txt` (480 = Spacewar test id) with the real App ID.

## Code map
| file | what |
|---|---|
| `src/map.js` | procedural Paris: streets, boulevards, plazas, cars, trees |
| `src/flow.js` | Dijkstra flow fields (one per goal, shared by thousands) |
| `src/crowd.js` | SoA agents, spatial grid, allocation-free step |
| `src/world.js` | fires, gas, trucks, squads, landmarks, economy, objectives |
| `src/ai.js` | police AI and protest AI |
| `src/render.js` | baked rooftop map, ImageData crowd layer, particles, night |
| `src/main.js` | menus, HUD, input, tools, loop, saves, achievements |
