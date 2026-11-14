import assert from "node:assert/strict";
import { test } from "node:test";
import type { HtmlBuilder } from "foldkit/html";
import { inertHtml } from "foldkit/html";
import { button, loading } from "../src/ui/primitives";

test("custom button styling preserves base and variant classes for an independent message type", () => {
  type Message = { readonly _tag: "Selected" };
  const h = inertHtml as unknown as HtmlBuilder<Message>;
  const rendered = button(h, {
    label: "Select",
    onClick: { _tag: "Selected" },
    variant: "primary",
    className: "mt-4",
    attributes: [h.Disabled(true), h.AriaLabel("Select item")],
  });
  assert.ok(rendered?.data);
  assert.deepEqual(rendered.data.class, {
    btn: true,
    primary: true,
    "mt-4": true,
  });
  assert.equal(rendered.data.props?.disabled, true);
  assert.equal(rendered.data.attrs?.["aria-label"], "Select item");
});

test("generic loading content carries no warehouse-specific guidance", () => {
  const rendered = loading(inertHtml, "Loading comments…");
  const text = JSON.stringify(rendered);
  assert.match(text, /Loading comments/);
  assert.doesNotMatch(text, /warehouse/i);
});
