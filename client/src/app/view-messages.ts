import type { Message as MapMessage } from "../features/map/view-messages";
import type { Message as OverviewMessage } from "../features/overview/view-messages";
import type { Message as TripsMessage } from "../features/trips/view-messages";
import { Message as M, type Message } from "./message";

type ExploreMessage =
  | typeof MapMessage.Type
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
    case "SelectZip":
      return M.PickZip({ zip: message.zip });
    default:
      return message;
  }
}
