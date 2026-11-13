import { format, parseISO } from "date-fns";
import {
  ArrowRight,
  CalendarDays,
  MapPin,
  SlidersHorizontal,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { Filters } from "../../../src/domain";
import { useFilters } from "../api";
import { Badge, Button } from "./ui";

export function FilterSummary({ filters }: { filters: Filters }) {
  const from = filters.from && format(parseISO(filters.from), "MMM d, yyyy");
  const to = filters.to && format(parseISO(filters.to), "MMM d, yyyy");
  const dates = from
    ? to
      ? `${from} – ${to}`
      : `From ${from}`
    : to
      ? `Through ${to}`
      : "All dates";

  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="secondary" className="whitespace-normal">
        <CalendarDays className="size-3 shrink-0" />
        {dates}
      </Badge>
      <Badge variant="secondary">
        <MapPin className="size-3 shrink-0" />
        {filters.zip ? `Pickup ZIP ${filters.zip}` : "All pickup areas"}
      </Badge>
    </div>
  );
}

export function ExploreContext({ purpose }: { purpose: "note" | "question" }) {
  const { filters, query } = useFilters();
  const title =
    purpose === "note"
      ? "Explore view for new notes"
      : "Explore view for your next question";

  return (
    <section aria-label={title} className="rounded-lg border bg-muted/30 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
          {title}
        </h2>
        <Button asChild variant="link" size="sm" className="h-auto p-0">
          <Link to={`/trips${query ? `?${query}` : ""}`}>
            Change in Explore
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>
      <FilterSummary filters={filters} />
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        {purpose === "note"
          ? "New notes save these filters. Saved notes keep their own view."
          : query
            ? "These filters are sent with each new question. Earlier answers stay unchanged."
            : "No Explore filters selected. Choose a view in Explore to focus your questions."}
      </p>
    </section>
  );
}
