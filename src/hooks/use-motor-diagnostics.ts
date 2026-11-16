import { useEffect } from "react";
import { useStore } from "jotai";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { motorDiagnosticsSchema, type MotorDiagnostics } from "@/motor";
import { motorConnectedAtom, motorDiagnosticsAtom } from "@/stores/motor";
import { telemetryNativeSessionIdAtom } from "@/stores/telemetry";

/** Subscribe before querying; only telemetry's authenticated native session may publish. */
export function useMotorDiagnostics() {
  const store = useStore();
  useEffect(() => {
    let disposed = false;
    let ready = false;
    let revision = 0;
    let activeSession: string | undefined;
    let unlisten: UnlistenFn | undefined;
    const pending = new Map<string, MotorDiagnostics>();
    const query = async (sessionId: string) => {
      const expectedRevision = revision;
      try {
        const result = motorDiagnosticsSchema.parse(await invoke("get_motor_diagnostics"));
        if (disposed || revision !== expectedRevision || !store.get(motorConnectedAtom) ||
          store.get(telemetryNativeSessionIdAtom) !== sessionId || result.sessionId !== sessionId) return;
        store.set(motorDiagnosticsAtom, result);
      } catch (error) {
        if (!disposed && revision === expectedRevision) console.error("读取电机诊断失败", error);
      }
    };
    const sync = () => {
      const sessionId = store.get(motorConnectedAtom) ? store.get(telemetryNativeSessionIdAtom) : undefined;
      revision++;
      activeSession = sessionId;
      store.set(motorDiagnosticsAtom, sessionId ? pending.get(sessionId) : undefined);
      if (!store.get(motorConnectedAtom) || sessionId) pending.clear();
      if (ready && sessionId) void query(sessionId);
    };
    const unsubscribeConnection = store.sub(motorConnectedAtom, sync);
    const unsubscribeSession = store.sub(telemetryNativeSessionIdAtom, sync);
    sync();
    void listen<unknown>("motor-diagnostics", ({ payload }) => {
      if (disposed || !store.get(motorConnectedAtom)) return;
      const parsed = motorDiagnosticsSchema.safeParse(payload);
      if (!parsed.success) return;
      const diagnostics = parsed.data;
      const sessionId = store.get(telemetryNativeSessionIdAtom);
      if (sessionId === undefined) {
        pending.set(diagnostics.sessionId, diagnostics);
      } else if (sessionId === diagnostics.sessionId) {
        revision++;
        store.set(motorDiagnosticsAtom, diagnostics);
      }
    }).then((stop) => {
      if (disposed) { stop(); return; }
      unlisten = stop;
      ready = true;
      if (activeSession) void query(activeSession);
    }).catch((error) => {
      if (!disposed) console.error("订阅电机诊断失败", error);
    });
    return () => {
      disposed = true;
      unsubscribeConnection();
      unsubscribeSession();
      unlisten?.();
      pending.clear();
      store.set(motorDiagnosticsAtom, undefined);
    };
  }, [store]);
}
