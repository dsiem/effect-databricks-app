import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CarTaxiFront,
  ChartNoAxesCombined,
  ChevronDown,
  Database,
  LayoutDashboard,
  Map as MapIcon,
  Menu,
  PanelLeftClose,
  Sparkles,
  Table2,
  X,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useFilters, useMetadata, useStatus } from "./api";
import { Button, cn, Input } from "./components/ui";

const links = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/trips", label: "Trip explorer", icon: Table2 },
  { to: "/map", label: "Pickup map", icon: MapIcon },
  { to: "/genie", label: "Ask Genie", icon: Sparkles },
  { to: "/notebook", label: "Analyst notebook", icon: BookOpen },
];
export function Layout() {
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const { filters, query, setFilters } = useFilters();
  const status = useStatus();
  const metadata = useMetadata();
  const current =
    links.find((link) => link.to === location.pathname)?.label ?? "Metrocab";
  return (
    <div className="min-h-dvh lg:pl-[232px]">
      {menu && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMenu(false)}
          aria-label="Close navigation"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[232px] flex-col bg-[#172f29] text-[#b5c5ba] transition-transform lg:translate-x-0",
          menu ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 px-6 pb-9 pt-8">
          <div className="flex size-9 items-center justify-center rounded-xl bg-[#f2d568] text-[#233a2e]">
            <CarTaxiFront className="size-5" />
          </div>
          <div>
            <p className="text-xl font-semibold tracking-tight text-white">
              metrocab<span className="text-[#f2d568]">.</span>
            </p>
            <p className="mt-0.5 text-[9px] uppercase tracking-[.2em]">
              NYC taxi analytics
            </p>
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            className="ml-auto lg:hidden"
            onClick={() => setMenu(false)}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mx-4 mb-7 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[.035] px-3 py-3 text-xs">
          <span className="grid size-6 place-content-center rounded bg-white/10 text-[10px] font-bold text-white">
            NY
          </span>
          <span>NYC Taxi Analytics</span>
          <ChevronDown className="ml-auto size-3" />
        </div>
        <p className="mb-3 px-7 text-[9px] font-medium uppercase tracking-[.18em] text-[#799486]">
          Workspace
        </p>
        <nav aria-label="Main navigation" className="space-y-1 px-3">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              end={to === "/"}
              to={`${to}${query ? `?${query}` : ""}`}
              onClick={() => setMenu(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-4 py-3 text-[13px] transition-colors hover:bg-white/5 hover:text-white",
                  isActive &&
                    "bg-[#f0d46b] text-[#26382e] hover:bg-[#f0d46b] hover:text-[#26382e] font-semibold",
                )
              }
            >
              <Icon className="size-[17px]" />
              {label}
              {to === "/genie" && (
                <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[8px]">
                  AI
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mx-5 mt-auto mb-5 rounded-xl border border-white/10 p-4">
          <Database className="mb-3 size-4 text-[#eed26c]" />
          <p className="text-xs font-medium text-white">SQL warehouse</p>
          <p className="mt-2 text-[11px] leading-5 text-[#94ab9e]">
            Trip queries use Databricks SQL.
          </p>
          <div className="mt-4 flex items-center gap-1.5 text-[10px] text-[#b4c5b8]">
            <span
              className={cn(
                "size-1.5 rounded-full",
                metadata.isSuccess ? "bg-[#a8c792]" : "bg-[#d7b66a]",
              )}
            />
            {metadata.isSuccess
              ? "SQL warehouse connected"
              : "Connecting to Databricks"}
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-white/10 px-6 py-5">
          <div className="grid size-8 place-content-center rounded-full bg-[#3b5144] text-[11px] font-semibold text-[#ead87f]">
            NY
          </div>
          <div>
            <p className="text-xs font-medium text-white">
              NYC analytics workspace
            </p>
            <p className="mt-1 text-[10px] text-[#7e9c8b]">Databricks Apps</p>
          </div>
          <PanelLeftClose className="ml-auto size-4 opacity-40" />
        </div>
      </aside>
      <header className="flex h-[72px] items-center justify-between gap-3 border-b bg-card px-5 lg:px-9">
        <div className="flex items-center gap-3 text-xs">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMenu(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <span className="text-muted-foreground">Workspace</span>
          <span className="text-border">/</span>
          <span className="font-medium">{current}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[11px] text-muted-foreground">
            Dataset: {status.data?.dataset ?? "NYC taxi trips"}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-5 py-7 lg:px-9 lg:py-8">
        {location.pathname !== "/genie" &&
          location.pathname !== "/notebook" && (
            <form
              key={query}
              className="mb-7 flex flex-wrap items-center gap-2 rounded-xl border bg-white/60 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                setFilters({
                  ...(data.get("from")
                    ? { from: String(data.get("from")) }
                    : {}),
                  ...(data.get("to") ? { to: String(data.get("to")) } : {}),
                  ...(data.get("zip") ? { zip: String(data.get("zip")) } : {}),
                });
              }}
            >
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
                className="h-9 w-[142px] text-xs"
              />
              <span className="text-xs text-muted-foreground">to</span>
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
                className="h-9 w-[142px] text-xs"
              />
              <div className="mx-2 hidden h-5 border-l sm:block" />
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
                className="h-9 w-32 text-xs"
              />
              <Button size="sm" type="submit">
                Apply
              </Button>
              {query && (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => setFilters({})}
                >
                  Reset
                </Button>
              )}
              <span className="ml-auto hidden text-[10px] text-muted-foreground xl:block">
                {metadata.data
                  ? `Available: ${metadata.data.from} — ${metadata.data.to}`
                  : "Dates follow the source dataset"}
              </span>
            </form>
          )}
        <div className="page-enter" key={location.pathname}>
          <Outlet />
        </div>
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ChartNoAxesCombined className="size-3.5" />
            Service configuration
          </span>
          <span className="flex flex-wrap items-center gap-3">
            {status.data && (
              <>
                <span>
                  SQL warehouse{" "}
                  {status.data.warehouse ? "configured" : "not configured"}
                </span>
                <span>
                  Genie {status.data.genie ? "configured" : "not configured"}
                </span>
                <span>
                  Lakebase{" "}
                  {status.data.lakebase ? "configured" : "not configured"}
                </span>
              </>
            )}
            <a
              href="https://docs.databricks.com/aws/en/dev-tools/databricks-apps/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-primary"
            >
              Databricks Apps documentation
              <ArrowUpRight className="size-3" />
            </a>
          </span>
        </footer>
      </main>
    </div>
  );
}
