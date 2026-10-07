import type { SessionLightsBridge, SettingsBridge } from '../shared/contracts.js';
declare global {
  interface Window {
    sessionLights: SessionLightsBridge;
    settings: SettingsBridge;
  }
}
export {};
