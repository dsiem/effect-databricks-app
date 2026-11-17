import type { Filters } from "../../../../shared/domain";
import { queryFor } from "../../domain/filters";
import type { Model } from "./model";

export function appliedView(
  model: Pick<Model, "selection" | "browser">,
  filters: Filters,
) {
  const query = queryFor(filters);
  const selection = model.selection;
  if (selection && queryFor(selection.filters) === query) return selection;
  return (
    [
      ...(model.browser.savedViews.data?.rows ?? []),
      ...(model.browser.shortcuts.data?.rows ?? []),
      ...(model.browser.shortcuts.data?.recents ?? []),
    ].find((savedView) => queryFor(savedView.filters) === query) ?? null
  );
}
