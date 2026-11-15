import { Command } from "foldkit";
import { filtersFromQuery } from "../../domain/filters";
import type { FeatureUpdate } from "../../lib/feature-update";
import { LoadGps } from "./commands";
import { Message as M, type Message } from "./messages";
import { dataKey, frameKey, type Model } from "./model";
import { RefreshGps } from "./mount";
import { EndpointTabs } from "./tabs";

const refresh = (model: Model, query: string) =>
  model.activity.data
    ? [
        RefreshGps({
          data: model.activity.data,
          key: frameKey(query, model.endpoint, model.selected),
          loading: model.activity.loading,
          selected: model.selected,
        }),
      ]
    : [];
export function reloadGps(
  model: Model,
  query: string,
): FeatureUpdate<Model, Message> {
  const next = {
    ...model,
    selected: null,
    renderedKey: "",
    mapError: "",
    activity: { ...model.activity, loading: true, error: "" },
  };
  return {
    model: next,
    commands: [
      LoadGps({
        key: dataKey(query, next.endpoint),
        filters: filtersFromQuery(query) ?? {},
        endpoint: next.endpoint,
      }),
      ...refresh(next, query),
    ],
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
      if (message.key !== dataKey(context.query, model.endpoint))
        return { model };
      const next = {
        ...model,
        activity: { data: message.data, loading: false, error: message.error },
        renderedKey: "",
        mapError: "",
        selected: null,
      };
      return { model: next, commands: refresh(next, context.query) };
    }
    case "GpsReady":
      return message.key !==
        frameKey(context.query, model.endpoint, model.selected)
        ? { model }
        : {
            model: {
              ...model,
              renderedKey: message.error ? "" : message.key,
              mapError: message.error,
            },
          };
    case "GpsSelect": {
      if (model.activity.loading) return { model };
      const next = { ...model, selected: message.id };
      return { model: next, commands: refresh(next, context.query) };
    }
  }
}
