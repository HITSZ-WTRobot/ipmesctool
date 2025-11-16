import "./App.css";
import { ThemeProvider } from "@/components/theme-provider.tsx";
import { SidebarProvider } from "@/components/ui/sidebar.tsx";
import AppSidebar from "@/components/app-sidebar.tsx";

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <SidebarProvider>
        <AppSidebar />
        <main className="h-screen w-screen flex flex-col items-center justify-center">
          <div className="flex flex-row flex-1"></div>
          <div className="flex flex-row w-full">
            <div></div>
            <div className="flex-1"></div>
          </div>
        </main>
      </SidebarProvider>
    </ThemeProvider>
  );
}

export default App;
