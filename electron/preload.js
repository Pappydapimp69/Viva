const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('steam', {
  activate: (id) => ipcRenderer.send('steam:activate', id),
  quit: () => ipcRenderer.send('app:quit'),
});
