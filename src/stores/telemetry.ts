import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EventCallback, UnlistenFn } from "@tauri-apps/api/event";
import { atom, useStore } from "jotai";
import { useEffect } from "react";
import { TelemetryHistory } from "@/lib/telemetry-history.ts";
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
interface TelemetryState {
  sessionId: string;
  mode: TelemetryMode;
}
interface TelemetryBatch {
  sessionId: string;
  samples: TelemetrySample[];
}
export type TelemetryHistories = Record<StreamMode, TelemetryHistory>;
export type TelemetryRetentionSeconds = 60 | 300 | 600 | 900;
const streamModes: readonly StreamMode[] = ["iabc", "idq", "speed", "position"];
const emptyHistories = (): TelemetryHistories => ({
  iabc: new TelemetryHistory(),
  idq: new TelemetryHistory(),
  speed: new TelemetryHistory(),
  position: new TelemetryHistory(),
});

export const telemetryModeAtom = atom<TelemetryMode>("none");
export const telemetryHistoriesAtom = atom<TelemetryHistories>(emptyHistories());
export const telemetrySessionAtom = atom(0);
/** Trusted native identity: established by querying, never by incoming events. */
export const telemetryNativeSessionIdAtom = atom<string | undefined>(undefined);
const telemetryConnectedAtom = atom(false);
const latestTelemetryTimeAtom = atom<number | undefined>(undefined);
const retentionSecondsAtom = atom<TelemetryRetentionSeconds>(300);
export const telemetryRetentionSecondsAtom = atom(
  (get) => get(retentionSecondsAtom),
  (get, set, seconds: number) => {
    if (seconds !== 60 && seconds !== 300 && seconds !== 600 && seconds !== 900) {
      throw new RangeError("Telemetry retention must be 60, 300, 600, or 900 seconds");
    }
    const previous = get(retentionSecondsAtom);
    if (seconds === previous) return;
    set(retentionSecondsAtom, seconds);
    const latestTime = get(latestTelemetryTimeAtom);
    if (seconds < previous && latestTime !== undefined) {
      const histories = get(telemetryHistoriesAtom);
      for (const mode of streamModes) histories[mode].trimBefore(latestTime - seconds);
      set(telemetryHistoriesAtom, { ...histories });
    }
  },
);
export const clearTelemetryAtom = atom(null, (_get, set) => {
  set(telemetryHistoriesAtom, emptyHistories());
});
const syncTelemetryConnectionAtom = atom(null, (get, set) => {
  const connected = get(motorConnectedAtom);
  if (connected === get(telemetryConnectedAtom)) return;
  set(telemetryConnectedAtom, connected);
  set(telemetryNativeSessionIdAtom, undefined);
  set(telemetryModeAtom, "none");
  if (connected) {
    set(telemetrySessionAtom, get(telemetrySessionAtom) + 1);
    set(telemetryHistoriesAtom, emptyHistories());
    set(latestTelemetryTimeAtom, undefined);
  }
});
const appendTelemetryAtom = atom(null, (get, set, batch: TelemetrySample[]) => {
  if (!get(motorConnectedAtom) || batch.length === 0) return;
  const grouped: Record<StreamMode, TelemetrySample[]> = { iabc: [], idq: [], speed: [], position: [] };
  let latestTime = get(latestTelemetryTimeAtom);
  for (const sample of batch) {
    grouped[sample.mode].push(sample);
    if (latestTime === undefined || sample.time > latestTime) latestTime = sample.time;
  }
  const histories = get(telemetryHistoriesAtom);
  const cutoff = latestTime! - get(retentionSecondsAtom);
  for (const mode of streamModes) {
    histories[mode].append(grouped[mode]);
    histories[mode].trimBefore(cutoff);
  }
  set(latestTelemetryTimeAtom, latestTime);
  set(telemetryHistoriesAtom, { ...histories });
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
    let connectionRevision = 0;
    let modeRevision = 0;
    const pendingDisconnects = new Set<string>();
    let ready = false;
    const unlisteners: UnlistenFn[] = [];
    const register = async <T,>(event: string, handler: EventCallback<T>) => {
      const unlisten = await listen<T>(event, (message) => {
        if (!disposed) handler(message);
      });
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    };
    const queryState = async () => {
      if (!store.get(motorConnectedAtom)) return;
      const expectedConnectionRevision = connectionRevision;
      const expectedModeRevision = modeRevision;
      try {
        const state = await invoke<TelemetryState>("get_telemetry_state");
        if (disposed || connectionRevision !== expectedConnectionRevision || !store.get(motorConnectedAtom)) return;
        const disconnected = pendingDisconnects.has(state.sessionId);
        pendingDisconnects.clear();
        store.set(telemetryNativeSessionIdAtom, state.sessionId);
        if (disconnected) {
          store.set(motorConnectedAtom, false);
        } else if (modeRevision === expectedModeRevision) {
          store.set(telemetryModeAtom, state.mode);
        }
      } catch (error) {
        if (!disposed && connectionRevision === expectedConnectionRevision && store.get(motorConnectedAtom)) {
          console.error("读取采集状态失败", error);
          // The native session cannot be authenticated; preserve history as disconnected.
          store.set(motorConnectedAtom, false);
        }
      }
    };
    const unsubscribeConnection = store.sub(motorConnectedAtom, () => {
      connectionRevision++;
      modeRevision = 0;
      pendingDisconnects.clear();
      store.set(syncTelemetryConnectionAtom);
      if (store.get(motorConnectedAtom) && ready) void queryState();
    });
    // Handles an already-connected mount without restarting the session on effect remounts.
    store.set(syncTelemetryConnectionAtom);
    const setup = async () => {
      await Promise.all([
        register<TelemetryState>("telemetry-mode", ({ payload }) => {
          if (!store.get(motorConnectedAtom) || store.get(telemetryNativeSessionIdAtom) !== payload.sessionId) return;
          modeRevision++;
          store.set(telemetryModeAtom, payload.mode);
        }),
        register<TelemetryBatch>("telemetry-samples", ({ payload }) => {
          if (store.get(motorConnectedAtom) && store.get(telemetryNativeSessionIdAtom) === payload.sessionId) {
            store.set(appendTelemetryAtom, payload.samples);
          }
        }),
        register<{ sessionId: string }>("motor-disconnected", ({ payload }) => {
          if (!store.get(motorConnectedAtom)) return;
          const sessionId = store.get(telemetryNativeSessionIdAtom);
          if (sessionId === undefined) pendingDisconnects.add(payload.sessionId);
          else if (sessionId === payload.sessionId) store.set(motorConnectedAtom, false);
        }),
      ]);
      if (disposed) return;
      ready = true;
      // Subscribe first, authenticate this connection, then accept only its events.
      await queryState();
    };
    void setup().catch((error) => {
      if (!disposed) console.error("订阅遥测失败", error);
    });
    return () => {
      disposed = true;
      unsubscribeConnection();
      pendingDisconnects.clear();
      for (const unlisten of unlisteners) unlisten();
    };
  }, [store]);
}
