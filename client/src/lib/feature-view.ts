import type { HtmlBuilder } from "foldkit/html";
import type { View } from "foldkit/submodel";
export const featureView = <Parent, Child, Model>(
  h: HtmlBuilder<Parent>,
  slotId: string,
  view: View<Model, Child>,
  model: Model,
  toParentMessage: (message: Child) => Parent,
) => h.submodel({ slotId, view, model, toParentMessage });
