import { defineView } from "foldkit/submodel";
import { filtersFromQuery, queryFor } from "../../domain/filters";
import { savedViewBrowser } from "./browser-view";
import type { Model } from "./model";
import { appliedView } from "./selection";
import { Message as M } from "./view-messages";

type ViewModel = Pick<
  Model,
  "browser" | "selection" | "savedViewBusy" | "savedViewError" | "deleting"
> & {
  readonly query: string;
  readonly canSave: boolean;
};

export const savedViewsView = defineView<ViewModel, typeof M.Type>(
  (model, h) => {
    const filters = filtersFromQuery(model.query) ?? {};
    return savedViewBrowser(h, {
      ...model.browser,
      selected: appliedView(model, filters),
      customFilters: !!queryFor(filters),
      canSave: model.canSave,
      mutationBusy: model.savedViewBusy,
      mutationError: model.deleting ? "" : model.savedViewError,
    });
  },
);
