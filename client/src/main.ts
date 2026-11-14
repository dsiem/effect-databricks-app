import { Option } from "effect";
import { Runtime, Url } from "foldkit";
import { subscriptions } from "./browser";
import { ApiClient } from "./lib/api-client";
import { Message } from "./message";
import { Model } from "./model";
import { init, update } from "./update";
import { view } from "./view";
import "./styles.css";
import "leaflet/dist/leaflet.css";

Runtime.run(
  Runtime.makeApplication({
    Model,
    init,
    update,
    view,
    subscriptions,
    resources: ApiClient.layer,
    container: document.getElementById("root"),
    routing: {
      onUrlRequest: (request) =>
        Message.Navigate({
          href:
            request._tag === "Internal"
              ? Url.toString(request.url)
              : request.href,
          external: request._tag === "External",
        }),
      onUrlChange: (url) =>
        Message.Navigated({
          path: url.pathname,
          query: Option.getOrElse(url.search, () => "").replace(/^\?/, ""),
        }),
    },
  }),
);
