import { format, parseISO } from "date-fns";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import type { DateRange } from "react-day-picker";
import type { Filters } from "../../../src/domain";
import { useIsMobile } from "../hooks/use-mobile";
import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function DateRangeFilter({
  from,
  to,
  min,
  max,
}: {
  from?: Filters["from"];
  to?: Filters["to"];
  min?: string | undefined;
  max?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>(() =>
    from || to
      ? {
          from: from ? parseISO(from) : undefined,
          to: to ? parseISO(to) : undefined,
        }
      : undefined,
  );
  const isMobile = useIsMobile();
  const triggerId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const minDate = min ? parseISO(min) : undefined;
  const maxDate = max ? parseISO(max) : undefined;
  const label = range?.from
    ? range.to
      ? `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`
      : `From ${format(range.from, "MMM d, yyyy")}`
    : range?.to
      ? `Through ${format(range.to, "MMM d, yyyy")}`
      : "Select date range";

  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-auto">
      <label htmlFor={triggerId} className="text-xs font-medium">
        Pickup date range
      </label>
      <input
        type="hidden"
        name="from"
        value={range?.from ? format(range.from, "yyyy-MM-dd") : ""}
      />
      <input
        type="hidden"
        name="to"
        value={range?.to ? format(range.to, "yyyy-MM-dd") : ""}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={triggerId}
            type="button"
            variant="outline"
            aria-label={`Pickup date range: ${label}`}
            className="w-full justify-start font-normal sm:w-[280px]"
          >
            <CalendarDays className="text-muted-foreground" />
            {label}
            <ChevronDown className="ml-auto text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={16}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="max-h-(--radix-popover-content-available-height) w-auto overflow-y-auto p-0"
        >
          <div className="border-b px-3 py-3">
            <h2 id={titleId} className="text-sm font-medium">
              Pickup dates
            </h2>
            <p
              id={descriptionId}
              className="mt-1 text-xs text-muted-foreground"
            >
              Select a start and end date.
            </p>
          </div>
          <Calendar
            mode="range"
            autoFocus
            selected={range}
            onSelect={setRange}
            defaultMonth={range?.from ?? range?.to ?? minDate ?? new Date()}
            numberOfMonths={isMobile ? 1 : 2}
            captionLayout="dropdown"
            {...(minDate ? { startMonth: minDate } : {})}
            {...(maxDate ? { endMonth: maxDate } : {})}
            disabled={[
              ...(minDate ? [{ before: minDate }] : []),
              ...(maxDate ? [{ after: maxDate }] : []),
            ]}
          />
          <div className="flex items-center justify-between border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!range?.from && !range?.to}
              onClick={() => setRange(undefined)}
            >
              Clear dates
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
