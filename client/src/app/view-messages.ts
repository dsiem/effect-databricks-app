import type { Message as GpsMessage } from "../features/gps/view-messages";
import type { Message as OverviewMessage } from "../features/overview/view-messages";
import type { Message as TripsMessage } from "../features/trips/view-messages";
import { Message as M, type Message } from "./message";

type ExploreMessage =
  | typeof GpsMessage.Type
  | typeof OverviewMessage.Type
  | typeof TripsMessage.Type;

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
