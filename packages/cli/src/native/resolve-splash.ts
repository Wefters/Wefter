import type { WefterConfig } from "../config/wefter-config-schema.js";

export const SPLASH_DEFAULTS = {
  minDuration: 0,
  maxDuration: 5000,
  dismissOn: "ready" as const,
  transition: "fade" as const,
};

export type ResolvedSplash =
  | { enabled: false }
  | {
      enabled: true;
      source: string;
      minDuration: number;
      maxDuration: number;
      dismissOn: "ready" | "timer";
      transition: "fade" | "none";
    };

export function resolveSplash(config: WefterConfig): ResolvedSplash {
  const s = config.splash;
  if (!s) return { enabled: false };

  return {
    enabled: true,
    source: s.source,
    minDuration: s.minDuration,
    maxDuration: s.maxDuration,
    dismissOn: s.dismissOn,
    transition: s.transition,
  };
}
