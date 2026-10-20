import { listen } from "@tauri-apps/api/event";
import { atom } from "jotai";
import { useSetAtom } from "jotai";
import { useEffect } from "react";

export interface SerialData {
  type: "rx" | "tx";
  data: string;
  timestamp: number;
}

export const SERIAL_LOG_LIMIT = 5000;
export const serialDataAtom = atom<SerialData[]>([]);
export const appendSerialDataAtom = atom(null, (get, set, batch: SerialData[]) => {
  if (batch.length === 0) return;
  set(serialDataAtom, get(serialDataAtom).concat(batch).slice(-SERIAL_LOG_LIMIT));
});

export function useSerialDebug() {
  const appendSerialData = useSetAtom(appendSerialDataAtom);
  useEffect(() => {
    let pending: SerialData[] = [];
    let disposed = false;
    const enqueue = (type: SerialData["type"], data: string) => {
      if (disposed) return;
      pending.push({ type, data, timestamp: Date.now() });
      if (pending.length > SERIAL_LOG_LIMIT) pending.splice(0, pending.length - SERIAL_LOG_LIMIT);
    };
    const lr = listen<string>("serial-received", (event) => enqueue("rx", event.payload));
    const lt = listen<string>("serial-sent", (event) => enqueue("tx", event.payload));
    const timer = window.setInterval(() => {
      if (pending.length === 0) return;
      appendSerialData(pending);
      pending = [];
    }, 33);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      void lr.then((unlisten) => unlisten());
      void lt.then((unlisten) => unlisten());
    };
  }, [appendSerialData]);
}
