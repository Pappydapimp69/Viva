// Desktop shell for Steam. Loads the same index.html the web build serves.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let steam = null;
try {
  // steam_appid.txt next to the exe holds the real App ID once Valve assigns one.
  const id = Number(require('fs').readFileSync(path.join(__dirname, '..', 'steam_appid.txt'), 'utf8').trim()) || 480;
  steam = require('steamworks.js').init(id);
} catch (e) { steam = null; /* running outside Steam: achievements stay local */ }

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 640,
    backgroundColor: '#111214', autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'index.html'));
}

ipcMain.on('steam:activate', (_e, id) => {
  try { if (steam) steam.achievement.activate(id); } catch (e) { /* ignore */ }
});
ipcMain.on('app:quit', () => app.quit());

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
