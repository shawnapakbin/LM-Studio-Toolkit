import { join } from "node:path";

import { app, BrowserWindow } from "electron";
import log from "electron-log";

import { registerIpcHandlers } from "./ipc-handlers";

function renderFailurePage(window: BrowserWindow, title: string, details: string) {
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <style>
        body { margin: 0; font-family: Segoe UI, sans-serif; background: #08110f; color: #f7faf8; }
        main { max-width: 880px; margin: 0 auto; padding: 48px 32px; }
        h1 { font-size: 32px; margin: 0 0 16px; }
        p { color: rgba(224,235,231,0.82); line-height: 1.6; }
        pre { white-space: pre-wrap; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 16px; overflow: auto; }
      </style>
    </head>
    <body>
      <main>
        <h1>${title}</h1>
        <p>The installer UI failed to load correctly. Details are shown below so the issue is visible instead of presenting a blank window.</p>
        <pre>${details.replace(/[<&>]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[char] ?? char)}</pre>
      </main>
    </body>
  </html>`;

  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  if (!window.isVisible()) {
    window.show();
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#0d1412",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  registerIpcHandlers(window);

  window.once("ready-to-show", () => {
    window.show();
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    const details = [`code: ${errorCode}`, `message: ${errorDescription}`, `url: ${validatedURL}`].join("\n");
    log.error("Renderer failed to load", details);
    renderFailurePage(window, "Installer failed to load", details);
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    const summary = [`reason: ${details.reason}`, `exitCode: ${details.exitCode}`].join("\n");
    log.error("Renderer process exited", summary);
    renderFailurePage(window, "Installer renderer crashed", summary);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    const rendererEntry = join(__dirname, "../renderer/index.html");
    void window.loadFile(rendererEntry).catch((error) => {
      const details = error instanceof Error ? error.stack ?? error.message : String(error);
      log.error("Unable to load packaged renderer", details);
      renderFailurePage(window, "Installer UI could not start", details);
    });
  }

  return window;
}

app.whenReady().then(() => {
  log.initialize();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});