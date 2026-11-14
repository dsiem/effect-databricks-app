import type { Filters } from "../../../../shared/domain";
import type { H } from "../../app/view-types";
import { dateLabel } from "../../lib/format";
import { badge } from "../../ui/primitives";
export const filterSummary = (h: H, filters: Filters) =>
  h.div(
    [h.Class("flex flex-wrap gap-1.5")],
    [
      badge(h, dateLabel(filters)),
      badge(h, filters.zip ? `Pickup ZIP ${filters.zip}` : "All pickup areas"),
    ],
  );
