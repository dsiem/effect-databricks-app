import type { HtmlBuilder } from "foldkit/html";
import { Message } from "./messages";

export { Message };
export type H = HtmlBuilder<typeof Message.Type>;
