import { compact, number } from "../lib/format";
import type { H } from "./primitives";

export const chart = <Message>(
  h: H<Message>,
  data: ReadonlyArray<{ label: string; value: number }>,
  name: string,
  bars = false,
) => {
  const max = Math.max(1, ...data.map((row) => row.value));
  const x = (i: number) => 48 + (i * 620) / Math.max(1, data.length - 1);
  const y = (value: number) => 215 - (value / max) * 180;
  const points = data.map((row, i) => `${x(i)},${y(row.value)}`).join(" ");
  return h.svg(
    [
      h.ViewBox("0 0 700 260"),
      h.Role("img"),
      h.AriaLabel(name),
      h.Class("chart"),
    ],
    [
      h.title([], [name]),
      ...[0, 0.25, 0.5, 0.75, 1].flatMap((fraction) => [
        h.line(
          [
            h.Attribute("x1", "45"),
            h.Attribute("x2", "680"),
            h.Attribute("y1", String(y(max * fraction))),
            h.Attribute("y2", String(y(max * fraction))),
            h.Stroke("var(--border)"),
          ],
          [],
        ),
        h.text(
          [
            h.Attribute("x", "0"),
            h.Attribute("y", String(y(max * fraction) + 4)),
            h.Fill("var(--muted-foreground)"),
            h.Attribute("font-size", "11"),
          ],
          [compact(max * fraction)],
        ),
      ]),
      ...(!bars && data.length
        ? [
            h.polygon(
              [
                h.Attribute(
                  "points",
                  `48,215 ${points} ${x(data.length - 1)},215`,
                ),
                h.Fill("var(--chart-1)"),
                h.Attribute("opacity", "0.12"),
              ],
              [],
            ),
            h.polyline(
              [
                h.Attribute("points", points),
                h.Fill("none"),
                h.Stroke("var(--chart-1)"),
                h.Attribute("stroke-width", "2.5"),
              ],
              [],
            ),
          ]
        : []),
      ...data.map((row, i) =>
        bars
          ? h.rect(
              [
                h.Attribute("x", String(45 + (i * 630) / data.length)),
                h.Attribute("y", String(y(row.value))),
                h.Attribute(
                  "width",
                  String(Math.max(2, 630 / data.length - 5)),
                ),
                h.Attribute("height", String(215 - y(row.value))),
                h.Attribute("rx", "3"),
                h.Fill("var(--chart-2)"),
              ],
              [h.title([], [`${row.label}: ${number(row.value)}`])],
            )
          : h.circle(
              [
                h.Attribute("cx", String(x(i))),
                h.Attribute("cy", String(y(row.value))),
                h.Attribute("r", "4"),
                h.Fill("var(--chart-1)"),
              ],
              [h.title([], [`${row.label}: ${number(row.value)}`])],
            ),
      ),
      ...data
        .filter((_, i) => i % Math.max(1, Math.ceil(data.length / 6)) === 0)
        .map((row) =>
          h.text(
            [
              h.Attribute("x", String(x(data.indexOf(row)))),
              h.Attribute("y", "245"),
              h.Fill("var(--muted-foreground)"),
              h.Attribute("font-size", "12"),
              h.Attribute("text-anchor", "middle"),
            ],
            [row.label],
          ),
        ),
    ],
  );
};
