# Steam store kit — PAVÉ: Paris Riot Manager

**Price:** $4.99 USD (launch discount 10–15%).
**Controller:** Full Controller Support (declare it on the store page).
**Genres / tags:** Strategy, Simulation, Real-Time Strategy, Sandbox, City, Physics, Top-Down, Indie, Singleplayer, Destruction.

## Short description
One city, up to 100,000 simulated people, two sides. March the crowd or command the CRS: crowd physics, car fires that jump with the wind, tear gas, mortars, barricades and fire trucks.

## About this game
Saturday, 2 PM, République.
- **Lead the protest.** March your blocs on République and Bastille. Block one street and they take the next.
- **Radicalise the bloc.** Casseurs hunt parked cars, and flames jump car to car with the wind.
- **Switch sides.** Command CRS companies: shield lines that span the street, charges, gas, kettles.
- **Send the trucks.** Push fire engines through the crowd before the arrondissement goes up.
- **Take the squares.** Mortars against shields after dark.
- **Sandbox** with up to 100,000 simulated people.

All events, places-as-depicted and messages are fictional; the city is procedurally generated.

## Achievements (ids used by the game)
| id | name |
|---|---|
| FIRST_FIRE | Allumer le feu — burn your first car |
| CENT | Cent voitures — 100 cars burned in one night |
| HOLD | Tenir la ligne — win Tenir la Ligne |
| POMPIER | Soldat du feu — extinguish 25 fires in one game |
| NASSE | La Nasse — win La Nasse |
| BRULE | Paris brûle-t-il ? — win Paris Brûle |
| PEACE | Manif pacifique — win a protest level with fewer than 5 cars burned |
| ALL3 | Trois étoiles — three stars on every level |

## Upload checklist
1. Steamworks partner account + $100 app fee → get the App ID; put it in `steam_appid.txt`.
2. Create the 8 achievements above in Steamworks (same API names).
3. `npm install && npm run dist` → upload `dist/win-unpacked` and `dist/linux-unpacked` depots with SteamPipe.
4. Content survey: mature-ish themes (civil unrest, property destruction), no gore.
5. Capsule art + trailer: record gameplay with the in-game captions (they match the trailer beats).
6. Coming Soon page ≥ 2 weeks before launch to collect wishlists.
