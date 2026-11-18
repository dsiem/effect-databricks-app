import { Dialog } from "@foldkit/ui";
import { Command } from "foldkit";
import type * as D from "../../../../shared/domain";
import type { ApiClient } from "../../lib/api-client";
import { syncDialog } from "../../lib/dialog";
import type { FeatureUpdate } from "../../lib/feature-update";
import * as GenieCommands from "./commands";
import { Message as M, type Message } from "./messages";
import { busy, type Model, type Turn, turnBase } from "./model";
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
          pollGeneration: model.pollGeneration + 1,
          persistenceError: message.persistenceError,
        },
        commands: message.turns.flatMap((turn) =>
          turn.state === "retrieving"
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
    case "SendQuestion": {
      const question = message.question.trim();
      if (busy(model) || !question || !context.filters || !context.enabled)
        return { model };
      return {
        model,
        commands: [
          GenieCommands.CreateTurn({
            question,
            filters: context.filters,
            context: model.genieSelection ?? context.context,
          }),
        ],
      };
    }
    case "CreatedTurn": {
      if (busy(model)) return { model };
      const turn = {
        id: message.id,
        question: message.question,
        filters: message.filters,
        context: message.context,
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
      const current = model.turns.find((turn) => turn.id === message.turn.id);
      return current ? changeTurn(model, current, message.turn) : { model };
    }
    case "PolledQuestion": {
      const turn = model.turns.find(({ id }) => id === message.id);
      if (
        message.generation !== model.pollGeneration ||
        turn?.state !== "waiting" ||
        turn.operation.conversationId !== message.operation.conversationId ||
        turn.operation.messageId !== message.operation.messageId
      ) {
        return { model };
      }
      return changeTurn(model, turn, {
        ...turnBase(turn),
        operation: turn.operation,
        ...message.outcome,
      });
    }
    case "ResumeTurn": {
      if (busy(model)) return { model };
      const turn = model.turns.find(({ id }) => id === message.id);
      return turn?.state === "paused"
        ? changeTurn(model, turn, {
            ...turnBase(turn),
            operation: turn.operation,
            state: turn.stage,
          })
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

function changeTurn(
  model: Model,
  current: Turn,
  next: Turn,
): FeatureUpdate<Model, Message> {
  const turns = model.turns.map((turn) => (turn.id === next.id ? next : turn));
  const commands: Command.Command<Message, never, ApiClient>[] = [
    GenieCommands.PersistTurns({ turns }),
  ];
  if (next.state === "retrieving" && current.state !== "retrieving")
    commands.push(GenieCommands.RetrieveQuestion({ turn: next }));
  return {
    model: {
      ...model,
      turns,
      pollGeneration:
        next.state === "waiting"
          ? model.pollGeneration + 1
          : model.pollGeneration,
    },
    commands,
  };
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
    model:
      dialog.model === model.helperDialog
        ? model
        : { ...model, helperDialog: dialog.model },
    commands: (dialog.commands ?? []).map((command) =>
      Command.mapMessage(command, (message) => M.GenieDialog({ message })),
    ),
  };
}
