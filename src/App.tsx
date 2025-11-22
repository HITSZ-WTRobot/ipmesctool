import "./App.css";
import { ThemeProvider } from "@/components/theme-provider.tsx";
import { SidebarProvider } from "@/components/ui/sidebar.tsx";
import AppSidebar from "@/components/app-sidebar.tsx";
import { Toaster } from "@/components/ui/sonner";
import React, { JSX, Suspense, useRef } from "react";
import { pageAtom, PageID } from "@/stores/page.ts";
import { useAtomValue } from "jotai";
import { useSerialDebug } from "@/stores/serial.ts";
import { AngleDisplaySwitcher } from "@/components/angle.tsx";
import { motorConfigUnsavedAtom } from "@/stores/motor.ts";

const SerialConsole = React.lazy(() => import("@/pages/serial-console.tsx"));
const PidConfig = React.lazy(() => import("@/pages/pid-config.tsx"));
const DeviceInfo = React.lazy(() => import("@/pages/device-info.tsx"));

export const LazyPages = {
  "Debug.Serial": SerialConsole,
  "Motor.PID": PidConfig,
  "Motor.Encoder": React.lazy(() => import("@/pages/encoder-config.tsx")),
  "Basic.DeviceInfo": DeviceInfo,
} as const;

function PersistentPages({ page }: { page: PageID }) {
  const pageInstances = useRef<Partial<Record<PageID, JSX.Element>>>({});

  // 如果当前页还没有渲染过，创建一个实例
  const PageComponent = LazyPages[page];
  if (!pageInstances.current[page]) {
    pageInstances.current[page] = (
      <Suspense fallback={<div>Loading...</div>}>
        <PageComponent />
      </Suspense>
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
  const unsaved = useAtomValue(motorConfigUnsavedAtom);
  useSerialDebug();
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <SidebarProvider className="h-screen w-screen">
        <AppSidebar />
        <div className="w-full h-screen flex flex-col items-center">
          <main className="w-full flex-1 overflow-y-scroll">
            <PersistentPages page={page} />
          </main>
          <footer className="flex flex-row w-full h-24 bg-accent">
            <AngleDisplaySwitcher />
            {unsaved && <span>*配置未写入 Flash</span>}
          </footer>
        </div>
        <Toaster />
      </SidebarProvider>
    </ThemeProvider>
  );
}

export default App;
