// Copies the playable web build into dist-web/ (what GitHub Pages serves).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'dist-web');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'src'), { recursive: true });
for (const f of ['index.html', 'style.css']) fs.copyFileSync(path.join(root, f), path.join(out, f));
for (const f of fs.readdirSync(path.join(root, 'src'))) fs.copyFileSync(path.join(root, 'src', f), path.join(out, 'src', f));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('web build ->', out);
