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
import { useAtom } from "jotai";
import { pageAtom, PageGroups } from "@/stores/page";
import { useMemo } from "react";

export default function AppSidebar() {
  const [page, setPage] = useAtom(pageAtom);
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
          <MotorState />
          <Device />
        </SidebarFooter>
      </Sidebar>
    ),
    [page, setPage],
  );
}
