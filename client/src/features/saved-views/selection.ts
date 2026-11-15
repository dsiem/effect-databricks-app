import type { Filters } from "../../../../shared/domain";
import { queryFor } from "../../domain/filters";
import type { Model } from "./model";

export function appliedView(model: Model, filters: Filters) {
  const query = queryFor(filters);
  const selection = model.selection;
  if (selection && queryFor(selection.filters) === query) return selection;
  return (
    model.notes.data?.rows.find((note) => queryFor(note.filters) === query) ??
    null
  );
}
