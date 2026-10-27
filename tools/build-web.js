// Copies the playable web build into dist-web/ (what GitHub Pages serves).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'dist-web');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'src'), { recursive: true });
// Per-deploy cache-bust on EVERY script and the stylesheet (Brain: busting only the
// entry leaves the other files on stale cache keys after a deploy).
let ver = process.env.GITHUB_SHA || '';
try { ver = ver || require('child_process').execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch (e) { ver = String(Date.now()); }
ver = ver.slice(0, 8);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/(src="src\/[\w-]+\.js)"/g, '$1?v=' + ver + '"')
  .replace('href="style.css"', 'href="style.css?v=' + ver + '"')
  .replace('<span id="ver"></span>', '<span id="ver"></span> · build ' + ver);
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.copyFileSync(path.join(root, 'style.css'), path.join(out, 'style.css'));
for (const f of fs.readdirSync(path.join(root, 'src'))) fs.copyFileSync(path.join(root, 'src', f), path.join(out, 'src', f));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('web build ->', out);
