import type { IpcRendererEvent } from 'electron';
import type { SessionLightsBridge, PanelPayload } from './shared/contracts.js';
import { contextBridge, ipcRenderer } from 'electron';
const bridge: SessionLightsBridge = {
  read: () => ipcRenderer.invoke('sessions:read'),
  action: value => ipcRenderer.invoke('panel:action', value),
  tooltip: value => ipcRenderer.send('panel:tooltip', value),
  subscribe: callback => {
    const listener = (_event: IpcRendererEvent, value: PanelPayload) => callback(value);
    ipcRenderer.on('sessions:update', listener);
    return () => ipcRenderer.removeListener('sessions:update', listener);
  }
};
contextBridge.exposeInMainWorld('sessionLights', bridge);
