import { Tooltip } from "@foldkit/ui";
export const initTooltip = (id: string) =>
  Tooltip.init({ id: `sidebar-${id}` });
