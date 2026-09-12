import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import App from "./App";
import { registerServiceWorker } from "./pwa/register-sw";
import "./index.css";

// Script-tag theme preflight (runs before React loads) so the first paint
// always matches the persisted theme — no dark/light flash.
const themeGuard = `
try {
  var t = localStorage.getItem('janosik-theme');
  if (t === null) {
    var o = localStorage.getItem('vortex-theme');
    if (o !== null) {
      try { localStorage.setItem('janosik-theme', o); } catch (e) {}
      try { localStorage.removeItem('vortex-theme'); } catch (e) {}
      t = o;
    }
  }
  var dark = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
} catch (e) {}
(function(){var s=document.createElement('style');s.id='__janosik_preflight';
s.textContent='*{transition:none!important}html{background:#0a0a0f}html.light{background:#f4f5f6}';
document.head.appendChild(s);})();
`;
const preflight = document.createElement("script");
preflight.textContent = themeGuard;
document.head.appendChild(preflight);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerServiceWorker();
