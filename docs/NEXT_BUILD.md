# Next build blueprint (from Brain + ZaneGPT audit, 2026-10-30)

## Where we are vs the trailer
Matched: protest or police sides, casseurs, burning cars + counter, fire spreading, barricades,
hold the line, crowd routing around gaps, kettling level, capture the landmarks, fireworks vs
shields, night level, group-chat phone.
Missing or weak:
- Scale. Trailer says 100,000 people. Measured: the "100,000" sandbox reaches ~37,000 agents at
  84 ms per tick (~12 sim fps) on a desktop CPU; ~14,000 at 16 ms. The hook is the scale.
- "Or play the pompiers" is not a playable side (trucks exist only inside police levels).
- "Until all of Paris burns": only one night level; no city-wide fire spectacle.
- "See you next Saturday": no week-to-week structure.
- Look: flat top-down pixels vs the trailer's deep, shadowed, smoky city.
- Never run on real hardware: phone performance, a real controller, the Electron/Steam build.
- No music. Balance tuned only by bots.

## Brain inputs
- The trailer must not stray from the game; capture real gameplay through test hooks.
- Breakouts change a core mechanic, not the theme; theme alone is not a hook.
- Wishlist math: week-one sales ~0.10-0.15x launch wishlists; Popular Upcoming needs ~7-10k.
- Price from band data: $5-9.99 reached 1k reviews 14.3% vs 8.7% under $5 (other genre).
- A system nothing on screen points at scores like one that does not exist.
- WebGL/worker contexts must be released or browsers kill the oldest.
- Open tension: does fast trailer pacing read on a phone-sized vertical ad?

## Stages
1. Scale engine: crowd sim in a Web Worker, WebGL agent renderer, level-of-detail for far crowds.
   Target 100k at 30 fps desktop, 20k on a phone. Perf test in CI.
2. Real hardware: owner plays on phone, controller and the Electron build; fix what breaks.
3. Pompiers side: third playable role, two levels (fires, hydrants, trucks through crowds).
4. Saturdays: campaign as weekly acts with carry-over (crowd mood, police budget) and a
   "see you next Saturday" end card.
5. Look and sound: building depth/shadows, heavier smoke, city-wide night glow, music loop.
6. Steam kit: real-gameplay trailer cut from test hooks on the trailer's beats, capsule art,
   demo build, store page, price decision.
