import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar.tsx";
import Device from "@/components/device.tsx";
import { MotorState } from "@/components/motor-state.tsx";

export default function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader></SidebarHeader>
      <SidebarContent></SidebarContent>
      <SidebarFooter>
        <MotorState />
        <Device />
      </SidebarFooter>
    </Sidebar>
  );
}
