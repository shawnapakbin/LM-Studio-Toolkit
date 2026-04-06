import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import "./styles.css";

function showBootstrapError(message: string) {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }

  root.innerHTML = `
    <main style="max-width: 960px; margin: 0 auto; padding: 48px 24px; color: #f7faf8; font-family: Segoe UI, sans-serif;">
      <section style="border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; background: rgba(255,255,255,0.05); padding: 28px;">
        <p style="letter-spacing: .22em; text-transform: uppercase; color: rgba(224,235,231,.72); margin: 0 0 12px; font-size: 12px;">Startup Error</p>
        <h1 style="margin: 0 0 12px; font-size: 32px;">Installer UI failed to start</h1>
        <p style="margin: 0 0 16px; color: rgba(224,235,231,.82);">A runtime error occurred before the installer could render. Details:</p>
        <pre style="white-space: pre-wrap; margin: 0; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; background: #09100e; padding: 14px; overflow: auto;">${message
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</pre>
      </section>
    </main>
  `;
}

window.addEventListener("error", (event) => {
  showBootstrapError(event.error?.stack ?? event.message ?? "Unknown renderer error");
});

window.addEventListener("unhandledrejection", (event) => {
  const reason =
    event.reason instanceof Error
      ? (event.reason.stack ?? event.reason.message)
      : String(event.reason);
  showBootstrapError(`Unhandled promise rejection:\n${reason}`);
});

try {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("Renderer root element #root was not found.");
  }

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} catch (error) {
  showBootstrapError(error instanceof Error ? (error.stack ?? error.message) : String(error));
}
