import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EventCallback, UnlistenFn } from "@tauri-apps/api/event";
import { atom, useStore } from "jotai";
import { useEffect } from "react";
import { motorConnectedAtom } from "@/stores/motor.ts";
import { appendSerialDataAtom } from "@/stores/serial.ts";

export type StreamMode = "iabc" | "idq" | "speed" | "position";
export type TelemetryMode = "none" | StreamMode;
export interface TelemetrySample {
  mode: StreamMode;
  /** Monotonic host receive time in seconds since this connection began. */
  time: number;
  values: number[];
  raw: string;
}
export type TelemetryHistories = Record<StreamMode, TelemetrySample[]>;
export const TELEMETRY_HISTORY_LIMIT = 10000;
const emptyHistories = (): TelemetryHistories => ({ iabc: [], idq: [], speed: [], position: [] });

export const telemetryModeAtom = atom<TelemetryMode>("none");
export const telemetryHistoriesAtom = atom<TelemetryHistories>(emptyHistories());
export const clearTelemetryAtom = atom(null, (_get, set) => {
  set(telemetryHistoriesAtom, emptyHistories());
});
const resetTelemetryAtom = atom(null, (_get, set) => {
  set(telemetryModeAtom, "none");
  set(telemetryHistoriesAtom, emptyHistories());
});
const appendTelemetryAtom = atom(null, (get, set, batch: TelemetrySample[]) => {
  if (batch.length === 0) return;
  const grouped = emptyHistories();
  for (const sample of batch) grouped[sample.mode].push(sample);
  const previous = get(telemetryHistoriesAtom);
  const next = { ...previous };
  for (const mode of Object.keys(grouped) as StreamMode[]) {
    if (grouped[mode].length) {
      next[mode] = previous[mode].concat(grouped[mode]).slice(-TELEMETRY_HISTORY_LIMIT);
    }
  }
  set(telemetryHistoriesAtom, next);
  const timestamp = Date.now();
  set(appendSerialDataAtom, batch.map((sample) => ({ type: "rx" as const, data: sample.raw, timestamp })));
});

export function setTelemetryMode(mode: TelemetryMode): Promise<void> {
  // A completed write is not a firmware acknowledgement: these commands have no ok.
  return invoke("set_telemetry_mode", { mode });
}

/** Mounted once by App, independent of which persistent page is visible. */
export function useTelemetry() {
  const store = useStore();
  useEffect(() => {
    let disposed = false;
    let revision = 0;
    let ready = false;
    const unlisteners: UnlistenFn[] = [];
    const register = async <T,>(event: string, handler: EventCallback<T>) => {
      const unlisten = await listen<T>(event, (message) => {
        if (!disposed) handler(message);
      });
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    };
    const queryMode = async () => {
      const expectedRevision = revision;
      try {
        const mode = await invoke<TelemetryMode>("get_telemetry_mode");
        if (!disposed && revision === expectedRevision && store.get(motorConnectedAtom)) {
          store.set(telemetryModeAtom, mode);
        }
      } catch (error) {
        if (!disposed && store.get(motorConnectedAtom)) console.error("读取采集模式失败", error);
      }
    };
    const unsubscribeConnection = store.sub(motorConnectedAtom, () => {
      revision++;
      if (!store.get(motorConnectedAtom)) store.set(resetTelemetryAtom);
      else if (ready) void queryMode();
    });
    const setup = async () => {
      await Promise.all([
        register<TelemetryMode>("telemetry-mode", ({ payload: mode }) => {
          revision++;
          if (store.get(motorConnectedAtom)) store.set(telemetryModeAtom, mode);
        }),
        register<TelemetrySample[]>("telemetry-samples", ({ payload: samples }) => {
          if (store.get(motorConnectedAtom)) store.set(appendTelemetryAtom, samples);
        }),
        register("motor-disconnected", () => {
          revision++;
          store.set(motorConnectedAtom, false);
          store.set(resetTelemetryAtom);
        }),
      ]);
      if (disposed) return;
      ready = true;
      // Subscribe first; a newer event or connection transition wins over this query.
      await queryMode();
    };
    void setup().catch((error) => {
      if (!disposed) console.error("订阅遥测失败", error);
    });
    return () => {
      disposed = true;
      unsubscribeConnection();
      for (const unlisten of unlisteners) unlisten();
    };
  }, [store]);
}
