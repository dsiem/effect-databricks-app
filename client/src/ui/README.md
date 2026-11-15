# Reusing the visual layer

The TypeScript helpers and their CSS form one visual layer for Foldkit. They
accept caller-owned messages and content. They do not import application state,
feature styles, or dataset schemas.

## Use it in another application

Copy `ui/` and `lib/format.ts`, which supplies the calendar and number formatting
helpers. Keep the existing Foldkit, `@foldkit/ui`, Effect, date-fns, and Tailwind
dependencies in the consuming application. Import the styles once from its CSS
entry point:

```css
@import "tailwindcss";
@import "./ui/styles.css";
```

Tailwind must scan the copied TypeScript helpers as well as the consuming views;
they use utility classes alongside the component classes. If the helpers live
outside Tailwind's detected source tree, register that directory with `@source`.
No stylesheet imports are hidden in the TypeScript helpers, so they can also be
rendered in Node tests without a CSS loader.

`theme.css` supplies the default palette and semantic tokens. Override or adapt
those tokens for another brand. Dark mode uses the `dark` class on the document
root; theme selection and persistence belong to the consuming application.
`base.css` includes page typography, canvas, focus, and native-control defaults.
Adapt those global defaults when embedding the components in an existing site.

## Find a component's styles

| Stylesheet         | Owns                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `theme.css`        | Palette, fonts, light/dark semantic tokens                                                                |
| `base.css`         | Document and native-element defaults                                                                      |
| `primitives.css`   | Buttons, cards, badges, metrics, titles, tables, loading, panel headers/footers, icon tiles, inset panels |
| `field.css`        | Labels, inputs, textareas, touch sizing                                                                   |
| `chart.css`        | SVG chart geometry and colors                                                                             |
| `dialog.css`       | Modal host/backdrop, dialog panel, headers/footers, right-hand sheet                                      |
| `date-field.css`   | Date control, calendar, and calendar popover                                                              |
| `filter-panel.css` | Filter layout, apply/reset controls, pending state, notices                                               |
| `view-picker.css`  | Picker popover, list layout, options, and management actions                                              |

Each component file includes its own responsive and accessibility media rules.
All component rules use `@layer components`, so Tailwind utilities can override
them intentionally. `styles.css` includes the complete set in dependency order.
For selective reuse, start with theme, base, and primitives; fields need
`field.css`, and date fields additionally need `date-field.css`. Import the
matching file for charts, dialogs, filter panels, or view pickers as needed.

Compose dialog content with `dialog-panel`, `dialog-header`, `dialog-footer`,
and `dialog-close`. Add `sheet` and `sheet-body` for a right-hand inspector.
Features supply their own sizing and placement overrides; generic dialog styles
never name a particular feature. The picker similarly exposes
`view-picker-header`, `view-picker-list`, and `view-picker-footer` for caller
content. These classes are part of the visual layer, even when the caller
supplies the markup.

## Keep ownership clear

`../styles.css` composes the application: Tailwind, this visual layer, the shell,
and feature styles. `../app/styles.css` owns navigation and appearance controls.
Each feature's `styles.css` owns its page layout and specialized presentation;
the map also owns the MapLibre vendor import. Features composed entirely from
shared components and utilities need no stylesheet.

Add reusable presentation here only when its inputs and selectors are independent
of a feature. Keep a component's media queries with the component. Keep overrides
scoped to the owning feature rather than changing a shared class globally.
`npm run architecture:check` enforces CSS dependency direction alongside the
TypeScript boundaries. `npm run build && npm run test:ui` checks the composed
desktop/mobile views; `npm run test:filters` covers Chromium and WebKit behavior.
