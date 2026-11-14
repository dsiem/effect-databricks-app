import { Schema } from "effect";
import type * as D from "../../../../shared/domain";
export const FilterDraft = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  zip: Schema.String,
});
export const Model = Schema.Struct({
  filterDraft: FilterDraft,
});

export type Model = typeof Model.Type;

export const init = (filters: D.Filters = {}): Model => ({
  filterDraft: {
    from: filters.from ?? "",
    to: filters.to ?? "",
    zip: filters.zip ?? "",
  },
});
