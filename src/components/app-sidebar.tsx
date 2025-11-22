import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar.tsx";
import Device from "@/components/device.tsx";
import { MotorState } from "@/components/motor-state.tsx";
import { useAtom, useAtomValue } from "jotai";
import { pageAtom, PageGroups } from "@/stores/page";
import { useMemo } from "react";
import RefreshConfigButton from "@/components/refresh-config-button.tsx";
import { motorConnectedAtom } from "@/stores/motor.ts";
import SaveConfigButton from "@/components/save-config-button.tsx";

export default function AppSidebar() {
  const [page, setPage] = useAtom(pageAtom);
  const connected = useAtomValue(motorConnectedAtom);
  return useMemo(
    () => (
      <Sidebar>
        <SidebarHeader></SidebarHeader>
        <SidebarContent>
          {PageGroups.map((group) => (
            <SidebarGroup key={group.name}>
              <SidebarGroupLabel>{group.name}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.pages.map((_page) => (
                    <SidebarMenuItem
                      key={_page.id}
                      onClick={() => setPage(_page.id)}
                    >
                      <SidebarMenuButton isActive={page === _page.id}>
                        {_page.name}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          {connected && (
            <>
              <SaveConfigButton />
              <RefreshConfigButton />
            </>
          )}
          <MotorState />
          <Device />
        </SidebarFooter>
      </Sidebar>
    ),
    [connected, page, setPage],
  );
}
