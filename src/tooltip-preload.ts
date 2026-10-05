import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { TooltipBridge, TooltipData } from './shared/contracts.js';
const bridge: TooltipBridge = {
  subscribe: callback => {
    const listener = (_event: IpcRendererEvent, value: TooltipData) => callback(value);
    ipcRenderer.on('tooltip:update', listener);
    return () => { ipcRenderer.removeListener('tooltip:update', listener); };
  }
};
contextBridge.exposeInMainWorld('tooltip', bridge);
