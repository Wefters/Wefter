import { invokeNative, registerHook } from "@wefter/core";

export interface PingResult {
  pong: boolean;
}

export interface TickEvent {
  count: number;
}

export const PingTest = {
  ping(): Promise<PingResult> {
    return invokeNative("ping-test", "ping") as Promise<PingResult>;
  },

  on(event: "tick", callback: (data: TickEvent) => void): { remove(): void } {
    return registerHook("tick", callback as (data: unknown) => void);
  },
};
