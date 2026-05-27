import http from "http";

export interface InteractionEvent {
  id: string;
  timestamp: number;
  x: number;
  y: number;
  z: number;
  meshId: string;
  prompt: string;
}

class StateManager {
  private queue: InteractionEvent[] = [];
  public currentWorkspace: string | null = null;
  public currentFile: string | null = null;

  // SSE clients
  private clients: any[] = [];

  // Delegate mode: when another HTTP server already owns port 3344,
  // route setFile / triggerReload calls to it instead of touching local state.
  private delegatePort: number | null = null;

  public setDelegateMode(port: number): void {
    this.delegatePort = port;
  }

  /** Fire-and-forget HTTP POST to the running server (delegate mode only). */
  private _post(path: string, body?: object): void {
    try {
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request({
        hostname: "localhost",
        port: this.delegatePort!,
        path,
        method: "POST",
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : {},
      });
      req.on("error", () => {}); // ignore — best-effort
      if (payload) req.write(payload);
      req.end();
    } catch {
      // Ignore — delegate is best-effort
    }
  }

  public addInteraction(event: Omit<InteractionEvent, "id" | "timestamp">) {
    const newEvent: InteractionEvent = {
      ...event,
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now(),
    };
    this.queue.push(newEvent);
    return newEvent;
  }

  public pollInteractions(): InteractionEvent[] {
    const events = [...this.queue];
    this.queue = [];
    return events;
  }

  public addClient(client: any) {
    this.clients.push(client);
  }

  public removeClient(client: any) {
    this.clients = this.clients.filter((c) => c !== client);
  }

  public triggerReload() {
    if (this.delegatePort !== null) {
      this._post("/api/reload");
      return;
    }
    this.clients.forEach((client) => {
      client.write("data: reload\n\n");
    });
  }

  public setFile(workspaceRoot: string, file: string) {
    if (this.delegatePort !== null) {
      // Delegate: update state on the running HTTP server so its /api/model and SSE work.
      this._post("/api/load", { file, workspace: workspaceRoot });
      return;
    }
    this.currentWorkspace = workspaceRoot;
    this.currentFile = file;
    this.triggerReload();
  }
}

export const stateManager = new StateManager();
