import React from "react";
import ReactDOM from "react-dom/client";
import App, { createAppRouter } from "@/App";
import { registerServiceWorker } from "@/pwa/register-sw";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App router={createAppRouter()} />
  </React.StrictMode>,
);

registerServiceWorker();
