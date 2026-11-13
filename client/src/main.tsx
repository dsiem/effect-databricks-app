import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Loading } from "./components/common";
import { Layout } from "./layout";
import "./styles.css";

const Overview = lazy(() => import("./pages/overview"));
const Trips = lazy(() => import("./pages/trips"));
const PickupMap = lazy(() => import("./pages/map"));
const Genie = lazy(() => import("./pages/genie"));
const Notebook = lazy(() => import("./pages/notebook"));
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
const root = document.getElementById("root");
if (!root) throw new Error("Missing app root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Suspense fallback={<Loading text="Loading…" />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Overview />} />
              <Route path="trips" element={<Trips />} />
              <Route path="map" element={<PickupMap />} />
              <Route path="genie" element={<Genie />} />
              <Route path="notebook" element={<Notebook />} />
              <Route
                path="*"
                element={
                  <div className="py-20 text-center">
                    Page not found.{" "}
                    <a href="/" className="underline">
                      Back to overview
                    </a>
                  </div>
                }
              />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
