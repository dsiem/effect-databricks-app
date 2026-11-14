import type { HtmlBuilder } from "foldkit/html";
import type { View } from "foldkit/submodel";
export const featureView = <Parent, Child extends Parent, Model>(
  h: HtmlBuilder<Parent>,
  slotId: string,
  view: View<Model, Child>,
  model: Model,
) => h.submodel({ slotId, view, model, toParentMessage: (message) => message });
