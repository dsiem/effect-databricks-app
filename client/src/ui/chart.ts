import { compact, number } from "../lib/format";
import type { H } from "./primitives";

export const chart = <Message>(
  h: H<Message>,
  {
    data,
    title,
    kind,
    formatValue = number,
    formatTick = compact,
  }: {
    readonly data: ReadonlyArray<{
      readonly label: string;
      readonly value: number;
    }>;
    readonly title: string;
    readonly kind: "area" | "bar";
    readonly formatValue?: (value: number) => string;
    readonly formatTick?: (value: number) => string;
  },
) => {
  const min = Math.min(0, ...data.map((row) => row.value));
  const range = Math.max(0, ...data.map((row) => row.value)) - min || 1;
  const x = (i: number) =>
    56 +
    (kind === "bar" || data.length === 1
      ? ((i + 0.5) * 612) / data.length
      : (i * 612) / (data.length - 1));
  const y = (value: number) => 215 - ((value - min) / range) * 180;
  const baseline = y(0);
  const barWidth = Math.max(1, 612 / Math.max(1, data.length) - 5);
  const points = data.map((row, i) => `${x(i)},${y(row.value)}`).join(" ");
  return h.svg(
    [
      h.ViewBox("0 0 700 260"),
      h.Role("img"),
      h.AriaLabel(title),
      h.Class("chart"),
    ],
    [
      h.title([], [title]),
      ...[0, 0.25, 0.5, 0.75, 1].flatMap((fraction) => [
        h.line(
          [
            h.Attribute("x1", "56"),
            h.Attribute("x2", "680"),
            h.Attribute("y1", String(y(min + range * fraction))),
            h.Attribute("y2", String(y(min + range * fraction))),
            h.Stroke("var(--color-gray-300)"),
          ],
          [],
        ),
        h.text(
          [
            h.Attribute("x", "48"),
            h.Attribute("text-anchor", "end"),
            h.Attribute("y", String(y(min + range * fraction) + 4)),
            h.Fill("var(--color-gray-600)"),
            h.Attribute("font-size", "11"),
          ],
          [formatTick(min + range * fraction)],
        ),
      ]),
      h.line(
        [
          h.Attribute("x1", "56"),
          h.Attribute("x2", "680"),
          h.Attribute("y1", String(baseline)),
          h.Attribute("y2", String(baseline)),
          h.Stroke("var(--color-gray-600)"),
        ],
        [],
      ),
      ...(kind === "area" && data.length
        ? [
            h.polygon(
              [
                h.Attribute(
                  "points",
                  `${x(0)},${baseline} ${points} ${x(data.length - 1)},${baseline}`,
                ),
                h.Fill("var(--color-blue-700)"),
                h.Attribute("opacity", "0.12"),
              ],
              [],
            ),
            h.polyline(
              [
                h.Attribute("points", points),
                h.Fill("none"),
                h.Stroke("var(--color-blue-700)"),
                h.Attribute("stroke-width", "2.5"),
              ],
              [],
            ),
          ]
        : []),
      ...data.map((row, i) =>
        kind === "bar"
          ? h.rect(
              [
                h.Attribute("x", String(x(i) - barWidth / 2)),
                h.Attribute("y", String(Math.min(baseline, y(row.value)))),
                h.Attribute("width", String(barWidth)),
                h.Attribute(
                  "height",
                  String(Math.abs(baseline - y(row.value))),
                ),
                h.Attribute("rx", "3"),
                h.Fill("var(--color-blue-700)"),
              ],
              [h.title([], [`${row.label}: ${formatValue(row.value)}`])],
            )
          : h.circle(
              [
                h.Attribute("cx", String(x(i))),
                h.Attribute("cy", String(y(row.value))),
                h.Attribute("r", "4"),
                h.Fill("var(--color-blue-700)"),
              ],
              [h.title([], [`${row.label}: ${formatValue(row.value)}`])],
            ),
      ),
      ...data.flatMap((row, index) =>
        index % Math.max(1, Math.ceil(data.length / 6)) === 0
          ? [
              h.text(
                [
                  h.Attribute("x", String(x(index))),
                  h.Attribute("y", "245"),
                  h.Fill("var(--color-gray-600)"),
                  h.Attribute("font-size", "12"),
                  h.Attribute("text-anchor", "middle"),
                ],
                [row.label],
              ),
            ]
          : [],
      ),
    ],
  );
};
