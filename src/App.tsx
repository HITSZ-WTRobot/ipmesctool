import "./App.css";
import { ThemeProvider } from "@/components/theme-provider.tsx";
import { SidebarProvider } from "@/components/ui/sidebar.tsx";
import AppSidebar from "@/components/app-sidebar.tsx";
import { Toaster } from "@/components/ui/sonner";
import React, { JSX, Suspense, useRef } from "react";
import { pageAtom, PageID, windowLockedAtom } from "@/stores/page.ts";
import { useAtomValue } from "jotai";
import { useSerialDebug } from "@/stores/serial.ts";
import {
  AngleDisplaySwitcher,
  SpeedDisplaySwitcher,
} from "@/components/unit.tsx";
import DebugRunConsole from "@/components/debug-run-console.tsx";
import { ErrorBoundary } from "@/components/error-boundary.tsx";

const SerialConsole = React.lazy(() => import("@/pages/serial-console.tsx"));
const PidConfig = React.lazy(() => import("@/pages/pid-config.tsx"));
const DeviceInfo = React.lazy(() => import("@/pages/device-info.tsx"));

export const LazyPages = {
  "Debug.Serial": SerialConsole,
  "Motor.PID": PidConfig,
  "Motor.Encoder": React.lazy(() => import("@/pages/encoder-config.tsx")),
  "Motor.Calibration": React.lazy(() => import("@/pages/calibration.tsx")),
  "Basic.DeviceInfo": DeviceInfo,
} as const;

function PersistentPages({ page }: { page: PageID }) {
  const pageInstances = useRef<Partial<Record<PageID, JSX.Element>>>({});

  // 如果当前页还没有渲染过，创建一个实例
  const PageComponent = LazyPages[page];
  if (!pageInstances.current[page]) {
    pageInstances.current[page] = (
      <ErrorBoundary>
        <Suspense fallback={<div>Loading...</div>}>
          <PageComponent />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <div className="relative w-full h-full">
      {Object.entries(pageInstances.current).map(([id, element]) => (
        <div
          key={id}
          style={{ display: id === page ? "block" : "none" }}
          className="w-full h-full"
        >
          {element}
        </div>
      ))}
    </div>
  );
}

function App() {
  const page = useAtomValue(pageAtom);
  const locked = useAtomValue(windowLockedAtom);
  useSerialDebug();
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      {locked && (
        <div className="fixed inset-0 bg-black/0 z-[9999] pointer-events-auto" />
      )}
      <SidebarProvider className="h-screen w-screen">
        <AppSidebar />
        <div className="w-full h-screen flex flex-col items-center">
          <main className="w-full flex-1 min-h-0 overflow-y-scroll">
            <PersistentPages page={page} />
          </main>
          <footer className="flex flex-row w-full min-h-32 shrink-0 bg-accent gap-4 px-4">
            <div className="flex flex-col p-1 gap-2 justify-evenly">
              <SpeedDisplaySwitcher />
              <AngleDisplaySwitcher />
            </div>
            <div className="flex-1 h-full p-1">
              <DebugRunConsole />
            </div>
          </footer>
        </div>
        <Toaster richColors closeButton />
      </SidebarProvider>
    </ThemeProvider>
  );
}

export default App;
