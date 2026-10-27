// Loads the browser scripts into Node (they attach to globalThis.PAVE).
const path = require('path');
const files = ['core', 'map', 'flow', 'crowd', 'world', 'ai', 'levels'];
for (const f of files) require(path.join(__dirname, '..', 'src', f + '.js'));
module.exports = globalThis.PAVE;
