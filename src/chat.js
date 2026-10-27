// The phone in the corner: the bloc's group chat when you protest, the
// préfecture radio when you police. Driven entirely by world events.
(function () {
  const P = globalThis.PAVE;
  const NAMES = ['inès', 'yanis', 'sarah', 'léa', 'théo', 'kevin', 'chloé', 'nadia', 'hugo', 'manon', 'karim', 'lucas', 'jade', 'enzo'];

  const PROT = {
    ignite: ['ça crame {street} 🔥', 'une caisse de plus {street}', '🔥🔥🔥 {street}', 'ça brûle {street} mdr'],
    gas: ['gazage {street} 😷', 'ramenez du sérum phy', 'lacrymo {street} reculez', 'on voit plus rien {street}'],
    charge: ['ils chargent {street} 💀', 'BRAV-M {street} attention', 'courez {street}!!'],
    capture: ['on tient {place} ✊', '{place} est à nous 🔥', 'ON EST À {PLACE}'],
    retake: ['ils ont repris {place} 😡', 'on a perdu {place}'],
    truck: ['les pompiers arrivent {street}', 'pin-pon {street} 🚒'],
    arrest: ['ils embarquent des gens {street}', 'interpellations {street} 💀'],
    barricade: ['barricade {street} 🚧', 'on bloque {street}'],
    reinforce: ['renforts de keufs qui arrivent', 'encore des cars de CRS 💀'],
    order: ['les keufs sont {street} 💀', 'ligne de CRS {street}', 'évitez {street}'],
    burst: ['les mortiers ont touché 🎆', 'feu d\'artifice sur les boucliers 🎆'],
    casseurs: ['le bloc noir est là 🖤', 'cagoules sorties {street}'],
    mobilise: ['tout le monde dehors 📣', 'rdv {street} venez'],
  };
  const POL = {
    ignite: ['Feu de véhicule, {street}.', 'Départ de feu signalé {street}.'],
    capture: ['On a perdu {place} !', 'Cortège maître de {place}.'],
    retake: ['{place} reprise.', 'Contrôle rétabli {place}.'],
    aiRoute: ['Cortège en direction de {place}.', 'Mouvement vers {place}.'],
    barricade: ['Barricade signalée {street}.'],
    fireworks: ['Tirs de mortiers {street} !', 'Artifices sur nos lignes {street} !'],
    arrest: ['Interpellations en cours {street}.'],
    casseurs: ['Black bloc constitué {street}.'],
    extinguished: ['Feu maîtrisé {street}.'],
    truck: ['Pompiers engagés {street}.'],
  };

  function Chat(el, side, map) {
    this.el = el; this.side = side; this.map = map;
    this.last = {};
    this.t = 0;
  }
  Chat.prototype.fill = function (tpl, e) {
    const street = this.map.streetAt(e.x || 0, e.y || 0);
    const place = e.name ? e.name : (this.map.landmarks[0] || {}).name || 'Répu';
    return tpl.replace('{street}', street).replace('{place}', place).replace('{PLACE}', place.toUpperCase());
  };
  Chat.prototype.post = function (text, who, cls) {
    const d = document.createElement('div');
    d.className = 'msg' + (cls ? ' ' + cls : '');
    if (who) { const w = document.createElement('span'); w.className = 'who'; w.textContent = who; d.appendChild(w); }
    d.appendChild(document.createTextNode(text));
    this.el.appendChild(d);
    while (this.el.children.length > 9) this.el.removeChild(this.el.firstChild);
    if (P.audio) P.audio.play('chat');
  };
  Chat.prototype.event = function (e, time) {
    const table = this.side === P.SIDE.PROTEST ? PROT : POL;
    const set = table[e.type];
    if (!set) return;
    const gap = e.type === 'capture' || e.type === 'retake' ? 0 : 7;
    if (this.last[e.type] != null && time - this.last[e.type] < gap) return;
    this.last[e.type] = time;
    const who = this.side === P.SIDE.PROTEST ? NAMES[(Math.random() * NAMES.length) | 0] : 'PC Préfecture';
    this.post(this.fill(set[(Math.random() * set.length) | 0], e), who);
  };
  Chat.prototype.me = function (text) { this.post(text, null, 'me'); };
  P.Chat = Chat;
})();
