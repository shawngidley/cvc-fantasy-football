import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js?v=20260822-2", { updateViaCache: "none" }).then(registration => registration.update()).catch(error => console.warn("CVC PWA service worker registration failed", error));
  });
}

const queryClient = new QueryClient();

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      // Forces POST for every request (queries included). httpBatchLink defaults to GET
      // for query-type procedures, which is normally a nice caching optimization, but it
      // also means a query's response is a plain cacheable GET -- an intermediate cache
      // anywhere in the path (browser HTTP cache, a proxy, Vercel's edge) can serve a
      // stale response independent of anything client-side like a service worker or
      // "Clear site data". Confirmed suspicious here: the news feed's underlying data was
      // verified correct in the database, but the app kept receiving a stale empty result.
      // POST responses aren't cached by default anywhere, which removes this whole class
      // of bug even if it wasn't specifically confirmed as the cause.
      methodOverride: "POST",
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
