const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tooltip', {
  subscribe: callback => ipcRenderer.on('tooltip:update', (_event, value) => callback(value))
});
