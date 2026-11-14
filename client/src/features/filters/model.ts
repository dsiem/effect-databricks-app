import { DatePicker } from "@foldkit/ui";
import { Schema } from "effect";
import type * as D from "../../../../shared/domain";
export const FilterDraft = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  zip: Schema.String,
});
export const Model = Schema.Struct({
  filterDraft: FilterDraft,
  error: Schema.String,
  datePickers: Schema.NullOr(
    Schema.Struct({ from: DatePicker.Model, to: DatePicker.Model }),
  ),
});

export type Model = typeof Model.Type;

export const init = (filters: D.Filters = {}): Model => ({
  error: "",
  datePickers: null,
  filterDraft: {
    from: filters.from ?? "",
    to: filters.to ?? "",
    zip: filters.zip ?? "",
  },
});
