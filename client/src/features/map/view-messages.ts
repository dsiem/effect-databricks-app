import type { HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { uiMessages } from "../../lib/ui-messages";
import { messages as filterMessages } from "../filters/messages";
import { messages as genieMessages } from "../genie/messages";
import { messages } from "./messages";

export const Message = defineMessageUnion({
  ...uiMessages,
  ...messages,
  OpenGenie: genieMessages.OpenGenie,
  PickZip: filterMessages.PickZip,
});
export type H = HtmlBuilder<typeof Message.Type>;
