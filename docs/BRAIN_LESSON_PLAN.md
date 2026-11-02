# Brain lesson plan — crowd-riot RTS (before the $10 content build)

Why: Brain is thin exactly where Viva's next build lives (queried 2026-11-02):
`protest` 0 · `police` 0 · `kettling` 0 · `helbing` 0 · `replayability` 0 · `riot` 1 ·
`stars` 3 ideas · `campaign` 2 memory · `pricing` 0 memory · `roguelike` 2 ideas · `leaderboard` 1 memory.
Strong already (don't retrain): `simulation` 120 · `balance` 108 · `rts` 92 · `pathfinding`, `procgen`.

Rule for every lesson (Brain's own): real source or real scenario → small deterministic
sandbox that reproduces it → proposal from `brain mine` → `brain check` (ZaneGPT) →
`brain sleep` audit. Pre-register the prediction. One scenario built to break it.
Each module ends with a **Viva test**: a prediction about the game that we then measure.

## Order and modules

### 1. The comparables (market) — first, it decides scope
- Learn: what crowd/riot/protest games and $5–$10 small RTS games ship, at what length,
  price and review score — and *why* the close ones got the reviews they got
  (e.g. Riot: Civil Unrest's mixed reception; small-scope RTS like Mini Metro-style
  price/length; TABS-style crowd spectacle).
- Sources: Steam store pages, review text, SteamDB price/review history.
- Sandbox: hours-per-dollar vs review score table from real store data; fit, then
  predict a held-out game.
- Kernels: price band ↔ content length; top 3 review complaints for the genre.
- Viva test: predict which complaint Viva's current build would get; check against
  a blind playtest note.

### 2. Real crowd dynamics
- Learn: crowd density thresholds (people/m² where flow turns to crush), social-force /
  flocking models, how crowds split and route around blocks, panic vs. purposeful flow.
- Sources: Helbing social-force papers, G. Keith Still crowd-science material, evacuation data.
- Sandbox: corridor flow vs density; bottleneck flow rate vs width.
- Viva test: does Viva's crowd show the real flow-vs-density curve at a choke?
  If not, is the difference fun or a bug?

### 3. Protest policing and crowd psychology
- Learn: kettling, de-escalation, dispersal; the Elaborated Social Identity Model
  (Reicher / Stott): indiscriminate force turns a mostly-peaceful crowd hostile.
- Sources: Stott & Reicher papers, public policing reviews (e.g. post-G20 / HMIC reports).
- Sandbox: agent model where force raises hostility in bystanders, not just targets.
- Viva test: ESIM as a mechanic — heavy police force radicalises protesters
  (makes the police side a real dilemma, not just "gas everything").

### 4. Objective and star design
- Learn: objective types in small RTS missions, how stars/medals are set, idle-player
  and greedy-bot baselines, making thresholds visible.
- Sandbox: idle / naive-bot / good-bot runs per objective type; star cut-offs set
  from the bot spread.
- Viva test: La Nasse — after the fix, idle must lose; star 3 needs a better-than-bot run.

### 5. Difficulty and the AI opponent (resolves open tension T25)
- Learn: world harshness vs opponent skill; rubber-banding; per-side difficulty.
- Sandbox: same bot vs AI at 3 settings; win-rate curve and its spread.
- Viva test: Easy/Normal/Hard where the bot win rate lands near 90/60/30 %.

### 6. Replayability for small games
- Learn: daily seeded challenges, endless modes, leaderboards, roguelite meta-progression —
  what retains players in $5–$10 games and what's padding.
- Sources: postmortems (GDC), store review text mentioning "replay".
- Sandbox: seed-variety model — how different are two seeded runs, measured, not eyeballed.
- Viva test: daily seed — two dates' maps/objectives differ by a set measure.

### 7. Tone on a political theme
- Learn: how games about riots, protest and police are received; satire vs simulation;
  both-sides framing; Steam content rules and press angles.
- Sources: reviews and press coverage of protest/riot games.
- Output: a tension entry (it's a fork, not a rule) and a framing check list for the store page.

### 8. Playtesting without humans — and its limits
- Learn: what bots measure (stuck states, balance, length), what only humans can tell (fun,
  clarity, tone), cheap human tests (5-player hallway test, telemetry).
- Viva test: a bot report vs one real playtest; list what the bot missed.

## Size
About 8 modules × 2–3 lessons = ~20 lessons. Run 2 modules at a time; `brain save` after each.
Modules 1, 4 and 5 unblock the content build directly; 2 and 3 feed new mechanics;
6–8 shape the $10 version.
