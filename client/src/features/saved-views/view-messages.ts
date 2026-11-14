import type { HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { uiMessages } from "../../lib/ui-messages";
import { messages } from "./messages";

export const Message = defineMessageUnion({ ...uiMessages, ...messages });
export type H = HtmlBuilder<typeof Message.Type>;
