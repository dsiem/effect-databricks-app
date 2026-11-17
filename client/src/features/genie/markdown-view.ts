import type { HtmlBuilder } from "foldkit/html";
import type { MarkedToken, Token } from "marked";
import { type Child, table } from "../../ui/primitives";

// Render Markdown as VNodes. Raw HTML is text and link protocols are constrained.
export function markdown<Message>(
  h: HtmlBuilder<Message>,
  tokens: Token[],
): Child[] {
  const nested = (token: { tokens?: Token[]; text?: string }) =>
    token.tokens ? markdown(h, token.tokens) : [token.text ?? ""];
  return tokens.flatMap((raw): Child[] => {
    const token = raw as MarkedToken;
    switch (token.type) {
      case "space":
        return [];
      case "paragraph":
        return [h.p([], nested(token))];
      case "heading":
        return [h.h3([], nested(token))];
      case "text":
        return nested(token);
      case "strong":
        return [h.strong([], nested(token))];
      case "em":
        return [h.em([], nested(token))];
      case "del":
        return [h.del([], nested(token))];
      case "codespan":
        return [h.code([], [token.text])];
      case "code":
        return [h.pre([], [h.code([], [token.text])])];
      case "blockquote":
        return [h.blockquote([], markdown(h, token.tokens))];
      case "list":
        return [
          token.ordered
            ? h.ol(
                [],
                token.items.map((item) => h.li([], markdown(h, item.tokens))),
              )
            : h.ul(
                [],
                token.items.map((item) => h.li([], markdown(h, item.tokens))),
              ),
        ];
      case "link":
        return [
          /^(https?:|mailto:|\/|#)/i.test(token.href) &&
          !token.href.startsWith("//")
            ? h.a(
                [h.Href(token.href), h.Rel("noopener noreferrer")],
                nested(token),
              )
            : h.span([], nested(token)),
        ];
      case "br":
        return [h.br([])];
      case "hr":
        return [h.hr([])];
      case "table":
        return [
          table(h, {
            caption: "Genie answer table",
            headers: token.header.map((cell) => cell.text),
            // Markdown and query results are immutable snapshots without row IDs.
            rows: token.rows.map((row, index) => ({
              key: String(index),
              cells: row.map((cell) => h.span([], markdown(h, cell.tokens))),
            })),
          }),
        ];
      default:
        return ["text" in token ? String(token.text) : token.raw];
    }
  });
}
