import { Dialog } from "@foldkit/ui";
import { Command } from "foldkit";
import type * as D from "../../../../shared/domain";
import type { ApiClient } from "../../lib/api-client";
import { syncDialog } from "../../lib/dialog";
import type { FeatureUpdate } from "../../lib/feature-update";
import * as GenieCommands from "./commands";
import { Message as M, type Message } from "./messages";
import { busy, type Model, turnBase } from "./model";
export function updateGenie(
  model: Model,
  message: Message,
  context: Context,
): FeatureUpdate<Model, Message, Out> {
  switch (message._tag) {
    case "Idle":
      return { model };
    case "RestoredConversation":
      return {
        model: {
          ...model,
          turns: message.turns,
          persistenceError: message.persistenceError,
        },
        commands: message.turns.flatMap<
          Command.Command<Message, never, ApiClient>
        >((turn) =>
          turn.state === "waiting"
            ? [GenieCommands.PollQuestion({ turn })]
            : turn.state === "retrieving"
              ? [GenieCommands.RetrieveQuestion({ turn })]
              : [],
        ),
      };
    case "CloseGenie":
      return { model: { ...model, genieOpen: false } };
    case "GenieDialog": {
      const changed = Dialog.update(model.helperDialog, message.message);
      return {
        model: {
          ...model,
          helperDialog: changed.model,
          genieOpen:
            changed.outMessage?._tag === "Closed" ? false : model.genieOpen,
        },
        commands: (changed.commands ?? []).map((command) =>
          Command.mapMessage(command, (message) => M.GenieDialog({ message })),
        ),
      };
    }
    case "OpenGenie":
      return {
        model: {
          ...model,
          genieOpen: true,
          genieSelection: message.context ?? model.genieSelection,
          genieDraft: message.question ?? model.genieDraft,
        },
        outMessage: { _tag: "Opened" },
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
        !context.filters ||
        !context.enabled
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
        filters: context.filters ?? {},
        context: model.genieSelection ?? context.context,
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
            context,
          )
        : { model };
    }
    case "EditQuestion":
      return {
        model: { ...model, genieDraft: message.question },
        outMessage: { _tag: "FocusComposer" },
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

export type Context = {
  readonly filters: D.Filters | null;
  readonly context: D.GenieContext;
  readonly enabled: boolean;
};
export type Out =
  | { readonly _tag: "Opened" }
  | { readonly _tag: "FocusComposer" };

/** The shell supplies presentation context; the feature owns the modal lifecycle. */
export function presentGenie(
  model: Model,
  modal: boolean,
): FeatureUpdate<Model, Message> {
  const dialog = syncDialog(model.helperDialog, modal && model.genieOpen);
  return {
    model: { ...model, helperDialog: dialog.model },
    commands: (dialog.commands ?? []).map((command) =>
      Command.mapMessage(command, (message) => M.GenieDialog({ message })),
    ),
  };
}
