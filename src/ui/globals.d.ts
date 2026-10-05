import type { SessionLightsBridge, TooltipBridge, SettingsBridge } from '../shared/contracts.js';
declare global {
  interface Window {
    sessionLights: SessionLightsBridge;
    tooltip: TooltipBridge;
    settings: SettingsBridge;
  }
}
export {};
