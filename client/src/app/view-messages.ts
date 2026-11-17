import type { Message as GpsMessage } from "../features/gps/view-messages";
import type { Message as OverviewMessage } from "../features/overview/view-messages";
import type { Message as TripsMessage } from "../features/trips/view-messages";
import { gpsMessage, Message as M, type Message } from "./message";

type ExploreMessage = typeof OverviewMessage.Type | typeof TripsMessage.Type;

export function exploreMessage(message: ExploreMessage): Message {
  switch (message._tag) {
    case "Analyze":
      return M.OpenGenie({
        context: message.context,
        question: message.question,
      });
    case "Reload":
      return M.LoadPage();
    default:
      return message;
  }
}

export function gpsViewMessage(message: typeof GpsMessage.Type): Message {
  return message._tag === "Analyze" || message._tag === "Reload"
    ? exploreMessage(message)
    : gpsMessage(message);
}
