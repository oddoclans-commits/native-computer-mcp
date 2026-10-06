import WebSocket from "ws";
import type { BrowserTarget } from "../../types.js";

interface CdpMessage {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface CdpConnection {
  socket: WebSocket;
  nextId: number;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>;
}

export interface BrowserStatus {
  ready: boolean;
  endpoint: string;
  browser?: string;
  message?: string;
}

export class CdpBrowserSurface {
  private readonly connections = new Map<string, CdpConnection>();

  async status(endpoint = "http://127.0.0.1:9222"): Promise<BrowserStatus> {
    try {
      const version = await this.httpJson<{ Browser?: string }>(endpoint, "/json/version");
      return {
        ready: true,
        endpoint,
        ...(version.Browser ? { browser: version.Browser } : {}),
        message: "Chromium DevTools Protocol endpoint is reachable."
      };
    } catch (error) {
      return {
        ready: false,
        endpoint,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async listTargets(endpoint = "http://127.0.0.1:9222"): Promise<BrowserTarget[]> {
    return this.httpJson<BrowserTarget[]>(endpoint, "/json/list");
  }

  async snapshot(targetId: string, endpoint = "http://127.0.0.1:9222") {
    const connection = await this.connectionFor(targetId, endpoint);
    await this.call(connection, "Accessibility.enable", {});
    return this.call(connection, "Accessibility.getFullAXTree", {});
  }

  async navigate(
    targetId: string,
    url: string,
    endpoint = "http://127.0.0.1:9222"
  ) {
    const connection = await this.connectionFor(targetId, endpoint);
    return this.call(connection, "Page.navigate", { url });
  }

  async evaluate(
    targetId: string,
    expression: string,
    endpoint = "http://127.0.0.1:9222"
  ) {
    const connection = await this.connectionFor(targetId, endpoint);
    return this.call(connection, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
  }

  async close(): Promise<void> {
    for (const [targetId, connection] of this.connections) {
      connection.socket.close();
      this.connections.delete(targetId);
    }
  }

  private async connectionFor(
    targetId: string,
    endpoint: string
  ): Promise<CdpConnection> {
    const existing = this.connections.get(targetId);
    if (existing && existing.socket.readyState === WebSocket.OPEN) return existing;

    const targets = await this.listTargets(endpoint);
    const target = targets.find((item) => item.id === targetId);
    if (!target?.webSocketDebuggerUrl) {
      throw new Error(`No CDP websocket target found for "${targetId}".`);
    }

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const connection: CdpConnection = {
      socket,
      nextId: 1,
      pending: new Map()
    };

    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as CdpMessage;
        if (message.id === undefined) return;
        const pending = connection.pending.get(message.id);
        if (!pending) return;
        connection.pending.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result ?? {});
        }
      } catch {
        // Ignore malformed event payloads. Pending calls retain their timeout.
      }
    });

    socket.on("close", () => {
      this.connections.delete(targetId);
      for (const pending of connection.pending.values()) {
        pending.reject(new Error("CDP connection closed."));
      }
      connection.pending.clear();
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out connecting to CDP.")), 10_000);
      socket.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    this.connections.set(targetId, connection);
    return connection;
  }

  private call(connection: CdpConnection, method: string, params: Record<string, unknown>) {
    const id = connection.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        connection.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 20_000);

      connection.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      connection.socket.send(JSON.stringify({ id, method, params }), (error) => {
        if (error) {
          clearTimeout(timeout);
          connection.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  private async httpJson<T>(endpoint: string, path: string): Promise<T> {
    const base = endpoint.replace(/\/+$/, "");
    const response = await fetch(base + path);

    if (!response.ok) {
      throw new Error(`CDP HTTP ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as T;
  }
}
