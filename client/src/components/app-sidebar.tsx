import {
  BookOpen,
  CarTaxiFront,
  LayoutDashboard,
  Map as MapIcon,
  Sparkles,
  Table2,
  X,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useCurrentUser, useFilters } from "../api";
import { Button } from "./ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "./ui/sidebar";

export const navigation = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/trips", label: "Trip explorer", icon: Table2 },
  { to: "/map", label: "Pickup map", icon: MapIcon },
  { to: "/genie", label: "Ask Genie", icon: Sparkles },
  { to: "/notebook", label: "Analyst notebook", icon: BookOpen },
];

export function AppSidebar() {
  const user = useCurrentUser().data;
  const { query } = useFilters();
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const suffix = query ? `?${query}` : "";

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="flex-row items-center">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="NYC Taxi analytics">
              <NavLink to={`/${suffix}`} onClick={() => setOpenMobile(false)}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <CarTaxiFront className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">NYC Taxi</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Analytics workspace
                  </span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 md:hidden"
          aria-label="Close navigation"
          onClick={() => setOpenMobile(false)}
        >
          <X />
        </Button>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <nav id="main-navigation" aria-label="Main navigation">
          {[
            { label: "Explore", items: navigation.slice(0, 3) },
            { label: "Workspace", items: navigation.slice(3) },
          ].map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === to}
                        tooltip={label}
                      >
                        <NavLink
                          end={to === "/"}
                          to={`${to}${suffix}`}
                          aria-label={label}
                          onClick={() => setOpenMobile(false)}
                        >
                          <Icon />
                          <span>{label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                      {to === "/genie" && (
                        <SidebarMenuBadge>AI</SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
      {user && (
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                asChild
                tooltip={
                  user.email && user.email !== user.name
                    ? `${user.name} · ${user.email}`
                    : user.name
                }
              >
                <address
                  aria-label={`Signed in as ${user.name}`}
                  className="not-italic"
                >
                  <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium">
                    {user.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((part) => part[0])
                      .join("")
                      .toUpperCase()}
                  </div>
                  <div className="grid min-w-0 flex-1 gap-0.5 text-left group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-sm font-medium">
                      {user.name}
                    </span>
                    {user.email && user.email !== user.name && (
                      <span className="truncate text-xs text-muted-foreground">
                        {user.email}
                      </span>
                    )}
                  </div>
                </address>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      )}
      <SidebarRail />
    </Sidebar>
  );
}
