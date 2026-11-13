import {
  BookOpen,
  CalendarDays,
  LayoutDashboard,
  Map as MapIcon,
  Menu,
  Sparkles,
  Table2,
  X,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useFilters, useMetadata } from "./api";
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
  const metadata = useMetadata();
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
        <div className="flex justify-end px-6 pt-5 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="ml-auto lg:hidden"
            onClick={() => setMenu(false)}
          >
            <X className="size-4" />
          </button>
        </div>
        <nav aria-label="Main navigation" className="space-y-1 px-3 pt-5">
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
      </aside>
      <main className="mx-auto max-w-[1600px] px-5 py-7 lg:px-9 lg:py-8">
        <Button
          variant="ghost"
          size="icon"
          className="mb-4 lg:hidden"
          onClick={() => setMenu(true)}
          aria-label="Open navigation"
        >
          <Menu />
        </Button>
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
      </main>
    </div>
  );
}
