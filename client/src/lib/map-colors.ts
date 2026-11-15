import type { Color } from "@deck.gl/core";

export const activityColors = [20, 40, 60, 80, 100].map(
  (amount) =>
    `color-mix(in oklab, var(--chart-color) ${amount}%, var(--surface))`,
);

// Resolve the legend's CSS colors, including color-mix and theme tokens, to
// the numeric RGBA values that WebGL accepts.
export function mapColors(element: HTMLElement) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Unable to resolve map colors");
  const probe = document.createElement("span");
  probe.hidden = true;
  element.append(probe);
  const resolve = (color: string): Color => {
    probe.style.color = color;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = getComputedStyle(probe).color;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(
      0,
      0,
      1,
      1,
    ).data;
    return [r, g, b, a];
  };
  try {
    return {
      surface: resolve("var(--surface)"),
      subtle: resolve("var(--subtle)"),
      activity: activityColors.map(resolve),
    };
  } finally {
    probe.remove();
  }
}
