const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sessionLights', {
  read: () => ipcRenderer.invoke('sessions:read'),
  action: value => ipcRenderer.invoke('panel:action', value),
  tooltip: value => ipcRenderer.send('panel:tooltip', value),
  subscribe: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('sessions:update', listener);
    return () => ipcRenderer.removeListener('sessions:update', listener);
  }
});
