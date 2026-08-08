import type { WefterConfig } from "../config/wefter-config-schema.js";

export const SPLASH_DEFAULTS = {
  minDurationMs: 600,
  fadeOutDurationMs: 300,
};

export type ResolvedSplash =
  | { enabled: false }
  | { enabled: true; html: string; minDurationMs: number; fadeOutDurationMs: number };

export function resolveSplash(config: WefterConfig): ResolvedSplash {
  const s = config.splash;
  if (!s) return { enabled: false };

  return {
    enabled: true,
    html: s.html,
    minDurationMs: s.minDurationMs,
    fadeOutDurationMs: s.fadeOutDurationMs,
  };
}
