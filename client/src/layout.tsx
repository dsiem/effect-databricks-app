import { BookOpen, SlidersHorizontal, Sparkles } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useFilters, useMetadata } from "./api";
import { AppSidebar, navigation } from "./components/app-sidebar";
import { DateRangeFilter } from "./components/date-range-filter";
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
                className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3"
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
                <SlidersHorizontal className="mx-1 mb-2.5 hidden size-4 text-muted-foreground xl:block" />
                <DateRangeFilter
                  from={filters.from}
                  to={filters.to}
                  min={metadata.data?.from}
                  max={metadata.data?.to}
                />
                <Separator
                  orientation="vertical"
                  className="mx-1 mb-2 hidden data-[orientation=vertical]:h-5 md:block"
                />
                <div className="flex w-full flex-col gap-1.5 sm:w-52">
                  <label className="text-xs font-medium" htmlFor="pickup-zip">
                    Pickup ZIP code
                  </label>
                  <Input
                    id="pickup-zip"
                    name="zip"
                    placeholder="Enter ZIP (optional)"
                    defaultValue={filters.zip ?? ""}
                    inputMode="numeric"
                    pattern="[0-9]{5}"
                    maxLength={5}
                    className="bg-background"
                  />
                </div>
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
                <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
                  <span>Continue with applied Explore filters</span>
                  <Link
                    to={`/genie${query ? `?${query}` : ""}`}
                    className="inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    <Sparkles className="size-3.5" />
                    Ask Genie
                  </Link>
                  <Link
                    to={`/notebook${query ? `?${query}` : ""}`}
                    className="inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    <BookOpen className="size-3.5" />
                    Open notebook
                  </Link>
                </div>
              </form>
            )}
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
