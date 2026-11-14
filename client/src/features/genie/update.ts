import type { Command, Update } from "foldkit";
import * as AppCommands from "../../app/commands";
import { Message as M, type Message } from "../../app/message";
import {
  busy,
  filtersFromQuery,
  type Model,
  pageContext,
} from "../../app/model";
import type { ApiClient } from "../../lib/api-client";
import * as GenieCommands from "./commands";
import { turnBase } from "./model";
export function updateGenie(
  model: Model,
  message: Extract<
    Message,
    {
      readonly _tag:
        | "OpenGenie"
        | "ExpandGenie"
        | "ClearSelection"
        | "GenieDraft"
        | "SendQuestion"
        | "CreatedTurn"
        | "ChangedTurn"
        | "ResumeTurn"
        | "EditQuestion"
        | "NewConversation"
        | "Persisted"
        | "CopySql"
        | "CopiedSql";
    }
  >,
): Update.Return<Model, Message, ApiClient> {
  switch (message._tag) {
    case "OpenGenie":
      return {
        model: {
          ...model,
          mobileNavigation: false,
          genieOpen: true,
          genieSelection: message.context ?? model.genieSelection,
          genieDraft: message.question ?? model.genieDraft,
        },
        commands: [AppCommands.Focus({ selector: "#genie-composer" })],
      };
    case "ExpandGenie":
      return { model: { ...model, genieExpanded: !model.genieExpanded } };
    case "ClearSelection":
      return { model: { ...model, genieSelection: null } };
    case "GenieDraft":
      return { model: { ...model, genieDraft: message.value } };
    case "SendQuestion":
      return busy(model) ||
        !message.question.trim() ||
        !filtersFromQuery(model.query) ||
        !model.status.data?.genie
        ? { model }
        : {
            model,
            commands: [
              GenieCommands.CreateTurn({ question: message.question.trim() }),
            ],
          };
    case "CreatedTurn": {
      if (busy(model)) return { model };
      const turn = {
        id: message.id,
        question: message.question,
        filters: filtersFromQuery(model.query) ?? {},
        context: model.genieSelection ?? pageContext(model),
        state: "submitting" as const,
      };
      const previous = model.turns
        .toReversed()
        .find((turn) => "operation" in turn || turn.state === "complete");
      const conversationId =
        previous && "operation" in previous
          ? previous.operation.conversationId
          : previous?.state === "complete"
            ? previous.reply.conversationId
            : null;
      const turns = [...model.turns, turn];
      return {
        model: { ...model, turns, genieDraft: "" },
        commands: [
          GenieCommands.PersistTurns({ turns }),
          GenieCommands.SubmitQuestion({ turn, conversationId }),
        ],
      };
    }
    case "ChangedTurn": {
      const old = model.turns.find((turn) => turn.id === message.turn.id);
      if (!old) return { model };
      const turns = model.turns.map((turn) =>
        turn.id === message.turn.id ? message.turn : turn,
      );
      const commands: Command.Command<Message, never, ApiClient>[] = [
        GenieCommands.PersistTurns({ turns }),
      ];
      if (message.turn.state === "waiting" && old.state !== "waiting")
        commands.push(GenieCommands.PollQuestion({ turn: message.turn }));
      if (message.turn.state === "retrieving" && old.state !== "retrieving")
        commands.push(GenieCommands.RetrieveQuestion({ turn: message.turn }));
      return { model: { ...model, turns }, commands };
    }
    case "ResumeTurn": {
      if (busy(model)) return { model };
      const turn = model.turns.find((turn) => turn.id === message.id);
      return turn?.state === "paused"
        ? updateGenie(
            model,
            M.ChangedTurn({
              turn: {
                ...turnBase(turn),
                operation: turn.operation,
                state: turn.stage,
              },
            }),
          )
        : { model };
    }
    case "EditQuestion":
      return {
        model: { ...model, genieDraft: message.question },
        commands: [AppCommands.Focus({ selector: "#genie-composer" })],
      };
    case "NewConversation":
      return busy(model)
        ? { model }
        : {
            model: { ...model, turns: [] },
            commands: [GenieCommands.PersistTurns({ turns: [] })],
          };
    case "Persisted":
      return { model: { ...model, persistenceError: message.error } };
    case "CopySql":
      return { model, commands: [GenieCommands.CopySql({ sql: message.sql })] };
    case "CopiedSql":
      return { model: { ...model, clipboard: message.text } };
  }
}
