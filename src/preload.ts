import type { IpcRendererEvent } from 'electron';
import type { SessionLightsBridge, PanelPayload, SettingsBridge, SettingsPayload } from './shared/contracts.js';
import { contextBridge, ipcRenderer } from 'electron';
const bridge: SessionLightsBridge = {
  read: () => ipcRenderer.invoke('sessions:read'),
  action: value => ipcRenderer.invoke('panel:action', value),
  finishMotion: id => ipcRenderer.send('panel:motion-finished', id),
  subscribe: callback => {
    const listener = (_event: IpcRendererEvent, value: PanelPayload) => callback(value);
    ipcRenderer.on('sessions:update', listener);
    return () => ipcRenderer.removeListener('sessions:update', listener);
  }
};
contextBridge.exposeInMainWorld('sessionLights', bridge);
const settings: SettingsBridge = {
  read: () => ipcRenderer.invoke('settings:read'),
  action: value => ipcRenderer.invoke('settings:action', value),
  subscribe: callback => {
    const listener = (_event: IpcRendererEvent, value: SettingsPayload) => callback(value);
    ipcRenderer.on('settings:update', listener);
    return () => ipcRenderer.removeListener('settings:update', listener);
  }
};
contextBridge.exposeInMainWorld('settings', settings);
