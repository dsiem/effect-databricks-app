import { Option } from "effect";
import { Runtime, Url } from "foldkit";
import { subscriptions } from "./app/browser";
import { Message } from "./app/message";
import { Model } from "./app/model";
import { init, update } from "./app/update";
import { view } from "./app/view";
import { ApiClient } from "./lib/api-client";
import "./styles.css";

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
