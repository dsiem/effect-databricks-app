import { Menu } from "@foldkit/ui";
import { Schema } from "effect";

export const ThemePreference = Schema.Literals(["Dark", "Light", "System"]);
export type ThemePreference = typeof ThemePreference.Type;
export const ThemeMenu = Menu.create<ThemePreference>();
export const themeStorageKey = "metrocab.theme.v1";
export const systemThemeQuery = "(prefers-color-scheme: dark)";

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(themeStorageKey);
    if (Schema.is(ThemePreference)(stored)) return stored;
  } catch {
    // The system preference still works when browser storage is unavailable.
  }
  return "System";
}

export function applyTheme(preference: ThemePreference) {
  const dark =
    preference === "Dark" ||
    (preference === "System" && matchMedia(systemThemeQuery).matches);
  document.documentElement.classList.toggle("dark", dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      getComputedStyle(document.documentElement)
        .getPropertyValue("--canvas")
        .trim(),
    );
}
