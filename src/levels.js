// Campaign. Alternates sides: march with the crowd, then command the CRS.
(function () {
  const P = globalThis.PAVE;
  const S = P.SIDE;

  P.LEVELS = [
    {
      id: 'repu', name: 'Rendez-vous Répu', side: S.PROTEST, seed: 11, w: 288, h: 288,
      pop: 14000, squads: 3, squadSize: 40, trucks: 2, time: 360, cassFrac: 0.003, blocs: 1, landmarks: 3,
      names: ['République', 'Bastille', 'Nation'],
      caption: ['SATURDAY. 2 PM.', 'RÉPUBLIQUE.'],
      brief: 'Rally the bloc and take Place de la République. Left-click to set the march target. Push through — if a street is blocked, people route around it.',
      objectives: [{ type: 'captureNamed', lm: 0, label: 'Capture Place de la République' }],
      chat: ['rdv 14h répu 🔥', 'ramenez des parapluies ☔', 'on est combien là??'],
    },
    {
      id: 'casseurs', name: 'Les Casseurs', side: S.PROTEST, seed: 23, w: 320, h: 320,
      pop: 18000, squads: 5, trucks: 2, time: 420, cassFrac: 0.004, blocs: 2, aiTruckDelay: 12,
      caption: ['BLACK BLOC', 'RISING'],
      brief: 'Press [2] then click the crowd to infiltrate casseurs. They go for the parked cars — and flames jump to the next car.',
      objectives: [{ type: 'burn', n: 100, label: 'Burn 100 cars' }],
      chat: ['ce soir ça va être chaud', 'les keufs sont rue de Malte 💀', 'bloc noir devant'],
    },
    {
      id: 'line', name: 'Tenir la Ligne', side: S.POLICE, seed: 37, w: 288, h: 288,
      pop: 22000, squads: 5, trucks: 3, time: 300, cassFrac: 0.005, blocs: 2, landmarks: 3, authority: 60,
      names: ['Bastille', 'République', 'Nation'],
      caption: ['NOW SWITCH', 'SIDES'],
      brief: 'You command the CRS. Keep Place de la Bastille. Click a squad, right-click to form a line across the street. [G] tear gas, [B] barriers.',
      objectives: [{ type: 'hold', lm: 0, label: 'Hold Place de la Bastille', failText: 'Bastille has fallen.' }],
      chat: ['PC: toutes unités, manif déclarée place de la Bastille', 'PC: 20 000 selon la préfecture'],
    },
    {
      id: 'pompiers', name: 'Les Pompiers', side: S.POLICE, seed: 41, w: 320, h: 320,
      pop: 24000, squads: 5, trucks: 3, time: 360, cassFrac: 0.004, blocs: 2, authority: 70, starBurn: 45,
      caption: ['SIRENS', 'EVERYWHERE'],
      brief: 'Casseurs are torching the 11e. [F] then click a burning car to send a fire truck. Keep the damage under 80 cars.',
      objectives: [{ type: 'limit', n: 80, label: 'Fewer than 80 cars burned', failText: 'The arrondissement burned.' }],
      chat: ['PC: départs de feu signalés', 'PC: pompiers en route, dégagez les axes'],
    },
    {
      id: 'nasse', name: 'La Nasse', side: S.POLICE, seed: 53, w: 320, h: 320,
      pop: 26000, squads: 6, trucks: 3, time: 420, cassFrac: 0.012, blocs: 2, authority: 70,
      caption: ['CLOSE THE', 'NET'],
      brief: 'Kettle the black bloc. Close the streets with barriers, then [C] charge a squad into the casseurs to arrest them.',
      objectives: [{ type: 'arrest', n: 120, label: 'Arrest 120 casseurs' }],
      chat: ['PC: objectif interpellations', 'PC: fermez les rues adjacentes'],
    },
    {
      id: 'feux', name: "Feux d'Artifice", side: S.PROTEST, seed: 67, w: 320, h: 320, night: true,
      pop: 30000, squads: 7, trucks: 3, time: 540, cassFrac: 0.006, blocs: 2, maxSquads: 11, aiGasCd: 6,
      caption: ['MORTARS', 'AT DUSK'],
      brief: 'Night falls. [3] fireworks stun a police line. Capture three landmarks.',
      objectives: [{ type: 'capture', n: 3, label: 'Capture 3 landmarks' }],
      chat: ['ramenez les mortiers 🎆', 'c\'est les ténèbres ce soir', 'ils chargent bd Voltaire'],
    },
    {
      id: 'brule', name: 'Paris Brûle', side: S.PROTEST, seed: 79, w: 352, h: 352, night: true,
      pop: 42000, squads: 9, trucks: 4, time: 720, cassFrac: 0.01, blocs: 3, maxSquads: 14, aiGasCd: 5,
      caption: ['LAST NIGHT', 'BEFORE DAWN'],
      brief: 'The final night. Burn 250 cars before dawn.',
      objectives: [{ type: 'burn', n: 250, label: 'Burn 250 cars' }],
      chat: ['tout le monde dehors', 'ça brûle partout 🔥🔥', 'on lâche rien'],
    },
  ];

  P.sandboxLevel = function (o) {
    const police = o.side === S.POLICE;
    return {
      id: 'sandbox', name: 'Bac à Sable', side: o.side, seed: o.seed || 99, w: o.size || 320, h: o.size || 320,
      pop: o.pop || 30000, squads: o.squads || 6, trucks: 3, time: 1800, cassFrac: 0.008, blocs: 2,
      night: !!o.night, maxSquads: 14, authority: 80,
      caption: police ? ['SHIELDS', 'UP'] : [P.fmtNum(o.pop || 30000) + ' PEOPLE.', 'ONE CITY.'],
      brief: 'Sandbox. No objectives — just Paris.',
      objectives: [{ type: 'survive', label: 'Free play' }],
      chat: ['rdv 14h répu 🔥'],
    };
  };
})();
