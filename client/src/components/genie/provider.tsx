import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import type { GenieContext } from "../../../../src/domain";
import { useFilters } from "../../api";
import { useGenieConversation } from "../../lib/use-genie-conversation";

const generalContext: GenieContext = { page: "genie", title: "Taxi trip data" };
const pageNames: Record<string, GenieContext> = {
  "/": { page: "overview", title: "Trip overview" },
  "/trips": { page: "trips", title: "Trip records" },
  "/map": { page: "map", title: "Pickup activity" },
  "/notebook": { page: "notebook", title: "Analyst notebook" },
  "/genie": { page: "genie", title: "Taxi trip data" },
};

function useHelperState() {
  const { pathname, search } = useLocation();
  const route = pathname + search;
  const { filters, filterError } = useFilters();
  const conversation = useGenieConversation();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const opener = useRef<HTMLElement | null>(null);
  const [registered, register] = useState<{
    route: string;
    context: GenieContext;
  }>();
  const page =
    registered?.route === route
      ? registered.context
      : (pageNames[pathname] ?? generalContext);
  const viewKey = JSON.stringify([route, page]);
  const [selection, setSelection] = useState<{
    key: string;
    context: GenieContext;
  }>();
  const selected = selection?.key === viewKey;
  const context = selected ? selection.context : page;
  useEffect(() => {
    setSelection((current) => (current?.key === viewKey ? current : undefined));
  }, [viewKey]);
  const registerPage = useCallback(
    (route: string, context: GenieContext) => register({ route, context }),
    [],
  );
  const openHelper = (context?: GenieContext, question?: string) => {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (context) setSelection({ key: viewKey, context });
    if (question) setDraft(question);
    setOpen(true);
  };
  const send = (question: string) => {
    if (filterError || !question.trim() || conversation.busy) return;
    conversation.send(question, filters, context);
    setDraft("");
  };
  return {
    ...conversation,
    send,
    filters,
    filterError,
    context,
    selected,
    clearSelection: () => setSelection(undefined),
    open,
    setOpen,
    expanded,
    setExpanded,
    draft,
    setDraft,
    opener,
    openHelper,
    registerPage,
  };
}

const Genie = createContext<ReturnType<typeof useHelperState> | null>(null);

export function GenieProvider({ children }: { children: ReactNode }) {
  const value = useHelperState();
  return <Genie.Provider value={value}>{children}</Genie.Provider>;
}

export function useGenie() {
  const value = useContext(Genie);
  if (!value) throw new Error("GenieProvider is missing");
  return value;
}

// Register only the data actually rendered on the current page. Data changes
// invalidate a chart selection, so a new filter/sort never sends stale context.
export function useGeniePage(context: GenieContext) {
  const { pathname, search } = useLocation();
  const { registerPage } = useGenie();
  const { page, title, data } = context;
  useEffect(() => {
    registerPage(pathname + search, { page, title, ...(data ? { data } : {}) });
  }, [pathname, search, page, title, data, registerPage]);
}
