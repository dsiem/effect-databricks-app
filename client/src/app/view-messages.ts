import { Message as Genie } from "../features/genie/messages";
import type { Message as GpsMessage } from "../features/gps/view-messages";
import type { Message as OverviewMessage } from "../features/overview/view-messages";
import type { Message as TripsMessage } from "../features/trips/view-messages";
import {
  genieMessage,
  gpsMessage,
  Message as M,
  type Message,
  tripsMessage,
} from "./message";

export const openGenie = ({
  context,
  question,
}: Pick<ReturnType<typeof Genie.OpenGenie>, "context" | "question">) =>
  genieMessage(Genie.OpenGenie({ context, question }));

export function overviewViewMessage(
  message: typeof OverviewMessage.Type,
): Message {
  switch (message._tag) {
    case "Analyze":
      return openGenie(message);
    case "Reload":
      return M.LoadPage();
    default:
      return message;
  }
}

export function tripsViewMessage(message: typeof TripsMessage.Type): Message {
  return message._tag === "Reload" ? M.LoadPage() : tripsMessage(message);
}

export function gpsViewMessage(message: typeof GpsMessage.Type): Message {
  switch (message._tag) {
    case "Analyze":
      return openGenie(message);
    case "Reload":
      return M.LoadPage();
    default:
      return gpsMessage(message);
  }
}
