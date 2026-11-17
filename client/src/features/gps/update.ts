import { Command } from "foldkit";
import type { FeatureUpdate } from "../../lib/feature-update";
import { Message as M, type Message } from "./messages";
import { dataKey, frameKey, type Model } from "./model";
import { RefreshGps } from "./mount";
import { EndpointTabs } from "./tabs";

const refresh = (model: Model, query: string) => [
  RefreshGps({
    query,
    endpoint: model.endpoint,
    revision: model.revision,
    key: frameKey(query, model.endpoint, model.selected, model.revision),
    loading: model.activity.loading,
    selected: model.selected,
  }),
];
export function reloadGps(
  model: Model,
  query: string,
): FeatureUpdate<Model, Message> {
  const next = {
    ...model,
    selected: null,
    selectedCell: null,
    revision: model.revision + 1,
    renderedKey: "",
    mapError: "",
    activity: { ...model.activity, loading: true, error: "" },
  };
  return {
    model: next,
    commands: refresh(next, query),
  };
}
export function updateGps(
  model: Model,
  message: Message,
  context: { query: string },
): FeatureUpdate<Model, Message> {
  switch (message._tag) {
    case "Idle":
      return { model };
    case "GpsTabs": {
      const changed = EndpointTabs.update(model.endpointTabs, message.message);
      const next = {
        ...model,
        endpointTabs: changed.model,
        endpoint: changed.outMessage?.value ?? model.endpoint,
      };
      const loaded = changed.outMessage
        ? reloadGps(next, context.query)
        : { model: next };
      return {
        ...loaded,
        commands: [
          ...(changed.commands ?? []).map((command) =>
            Command.mapMessage(command, (message) => M.GpsTabs({ message })),
          ),
          ...(loaded.commands ?? []),
        ],
      };
    }
    case "LoadedGps": {
      if (
        message.key !== dataKey(context.query, model.endpoint, model.revision)
      )
        return { model };
      const next = {
        ...model,
        activity: { data: message.data, loading: false, error: message.error },
        renderedKey: "",
        mapError: "",
        selected: null,
        selectedCell: null,
      };
      return { model: next, commands: refresh(next, context.query) };
    }
    case "GpsReady":
      return message.key !==
        frameKey(context.query, model.endpoint, model.selected, model.revision)
        ? { model }
        : {
            model: {
              ...model,
              renderedKey: message.error ? "" : message.key,
              mapError: message.error,
              selectedCell:
                message.selectedCell === undefined
                  ? model.selectedCell
                  : message.selectedCell,
            },
          };
    case "GpsSelect": {
      if (model.activity.loading) return { model };
      const next = {
        ...model,
        selected: message.id,
        selectedCell:
          model.activity.data?.cells.find((cell) => cell.id === message.id) ??
          null,
      };
      return { model: next, commands: refresh(next, context.query) };
    }
  }
}
