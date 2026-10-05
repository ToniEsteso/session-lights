import { contextBridge, ipcRenderer } from 'electron';
import type { SettingsBridge, SettingsPayload } from './shared/contracts.js';
const bridge: SettingsBridge = {
  read: () => ipcRenderer.invoke('settings:read'),
  action: value => ipcRenderer.invoke('settings:action', value),
  subscribe: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: SettingsPayload) => callback(value);
    ipcRenderer.on('settings:update', listener);
    return () => ipcRenderer.removeListener('settings:update', listener);
  }
};
contextBridge.exposeInMainWorld('settings', bridge);
