import type * as D from "../../../../shared/domain";
import { Message as M } from "../../app/message";
import type { H } from "../../app/view-types";
import { icon } from "../../ui/icons";
import { button } from "../../ui/primitives";

export const ask = (
  h: H,
  label = "Ask Genie",
  context: D.GenieContext | null = null,
  question: string | null = null,
) =>
  button(h, {
    label: icon(h, "sparkles"),
    onClick: M.OpenGenie({ context, question }),
    attributes: [h.AriaLabel(label), h.Attribute("title", label)],
  });
