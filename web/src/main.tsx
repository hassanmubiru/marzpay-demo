import React from "react";
import { createRoot } from "react-dom/client";
import { createStreetClient } from "@streetjs/client";
import { StreetProvider } from "@streetjs/react";

import { App } from "./App";
import "./styles.css";

// One StreetJS client for the whole app. baseUrl "/api" is same-origin when the
// SPA is served by the backend under /app; in dev, Vite proxies /api to :3000.
const client = createStreetClient({ baseUrl: "/api" });

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found");
}

createRoot(rootEl).render(
  <React.StrictMode>
    <StreetProvider client={client}>
      <App />
    </StreetProvider>
  </React.StrictMode>,
);
