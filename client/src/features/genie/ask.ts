import type { HtmlBuilder } from "foldkit/html";
import type * as D from "../../../../shared/domain";
import { icon } from "../../ui/icons";
import { button } from "../../ui/primitives";

export const ask = <Message>(
  h: HtmlBuilder<Message>,
  onOpen: (context: D.GenieContext | null, question: string | null) => Message,
  label = "Ask Genie",
  context: D.GenieContext | null = null,
  question: string | null = null,
) =>
  button(h, {
    label: icon(h, "sparkles"),
    variant: "ghost",
    size: "icon",
    onClick: onOpen(context, question),
    attributes: [h.AriaLabel(label), h.Attribute("title", label)],
  });
