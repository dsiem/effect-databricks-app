import { CalendarDays, SlidersHorizontal } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useFilters, useMetadata } from "./api";
import { AppSidebar, navigation } from "./components/app-sidebar";
import { Button, Input } from "./components/ui";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./components/ui/breadcrumb";
import { Separator } from "./components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "./components/ui/sidebar";

function WorkspaceHeader() {
  const { pathname } = useLocation();
  const { open, isMobile, openMobile } = useSidebar();
  const { query } = useFilters();
  const current = navigation.find((item) => item.to === pathname);
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4 md:px-6">
      <SidebarTrigger
        className="-ml-1"
        aria-label={
          isMobile
            ? openMobile
              ? "Close navigation"
              : "Open navigation"
            : open
              ? "Collapse sidebar"
              : "Expand sidebar"
        }
        aria-expanded={isMobile ? openMobile : open}
        aria-controls="main-navigation"
      />
      <Separator
        orientation="vertical"
        className="mr-2 data-[orientation=vertical]:h-4"
      />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem className="hidden sm:block">
            <BreadcrumbLink asChild>
              <Link to={`/${query ? `?${query}` : ""}`}>NYC Taxi</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden sm:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{current?.label ?? "Workspace"}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}

export function Layout() {
  const location = useLocation();
  const { filters, query, setFilters } = useFilters();
  const metadata = useMetadata();
  return (
    <SidebarProvider
      defaultOpen={!document.cookie.split("; ").includes("sidebar_state=false")}
    >
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <WorkspaceHeader />
        <div className="mx-auto w-full max-w-[1600px] p-4 md:p-6 lg:p-8">
          {location.pathname !== "/genie" &&
            location.pathname !== "/notebook" && (
              <form
                key={query}
                aria-label="Trip filters"
                className="mb-8 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  setFilters({
                    ...(data.get("from")
                      ? { from: String(data.get("from")) }
                      : {}),
                    ...(data.get("to") ? { to: String(data.get("to")) } : {}),
                    ...(data.get("zip")
                      ? { zip: String(data.get("zip")) }
                      : {}),
                  });
                }}
              >
                <SlidersHorizontal className="mx-1 hidden size-4 text-muted-foreground xl:block" />
                <CalendarDays className="mx-1 hidden size-4 text-muted-foreground sm:block" />
                <label className="sr-only" htmlFor="date-from">
                  From date
                </label>
                <Input
                  id="date-from"
                  name="from"
                  type="date"
                  defaultValue={filters.from ?? ""}
                  min={metadata.data?.from}
                  max={filters.to || metadata.data?.to}
                  className="w-[145px] bg-background"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <label className="sr-only" htmlFor="date-to">
                  To date
                </label>
                <Input
                  id="date-to"
                  name="to"
                  type="date"
                  defaultValue={filters.to ?? ""}
                  min={filters.from || metadata.data?.from}
                  max={metadata.data?.to}
                  className="w-[145px] bg-background"
                />
                <Separator
                  orientation="vertical"
                  className="mx-1 hidden data-[orientation=vertical]:h-5 md:block"
                />
                <label className="sr-only" htmlFor="pickup-zip">
                  Pickup ZIP
                </label>
                <Input
                  id="pickup-zip"
                  name="zip"
                  placeholder="All pickup ZIPs"
                  defaultValue={filters.zip ?? ""}
                  inputMode="numeric"
                  pattern="[0-9]{5}"
                  maxLength={5}
                  className="w-36 bg-background"
                />
                <Button type="submit">Apply</Button>
                {query && (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setFilters({})}
                  >
                    Reset
                  </Button>
                )}
                <span className="ml-auto hidden text-xs text-muted-foreground 2xl:block">
                  {metadata.data
                    ? `Available: ${metadata.data.from} — ${metadata.data.to}`
                    : "Dates follow the source dataset"}
                </span>
              </form>
            )}
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
