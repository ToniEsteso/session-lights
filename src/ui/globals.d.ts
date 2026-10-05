import type { SessionLightsBridge, TooltipBridge } from '../shared/contracts.js';
declare global {
  interface Window {
    sessionLights: SessionLightsBridge;
    tooltip: TooltipBridge;
  }
}
export {};
