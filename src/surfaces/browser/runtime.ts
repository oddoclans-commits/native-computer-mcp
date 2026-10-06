import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { BrowserTarget } from "../../types.js";

export interface BrowserSession {
  id: string;
  targetId: string;
  endpoint: string;
  type: string;
  title?: string;
  url?: string;
  userDataDir?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StartBrowserSessionInput {
  targetId?: string;
  endpoint?: string;
  userDataDir?: string;
  executable?: string;
  url?: string;
}

export interface BrowserLaunchResult {
  started: boolean;
  reused: boolean;
  endpoint: string;
  pid?: number;
  executable?: string;
  message: string;
}

export class BrowserSessionStore {
  constructor(private readonly filePath = ".artifacts/browser-sessions/sessions.json") {}

  async list(): Promise<BrowserSession[]> {
    return Object.values(await this.load());
  }

  async get(id: string): Promise<BrowserSession | undefined> {
    const sessions = await this.load();
    return sessions[id];
  }

  async create(input: {
    targetId: string;
    endpoint: string;
    target: BrowserTarget;
    userDataDir?: string;
  }): Promise<BrowserSession> {
    const sessions = await this.load();
    const now = new Date().toISOString();
    const session: BrowserSession = {
      id: randomUUID(),
      targetId: input.targetId,
      endpoint: input.endpoint,
      type: input.target.type,
      ...(input.target.title ? { title: input.target.title } : {}),
      ...(input.target.url ? { url: input.target.url } : {}),
      ...(input.userDataDir ? { userDataDir: input.userDataDir } : {}),
      createdAt: now,
      updatedAt: now
    };
    sessions[session.id] = session;
    await this.save(sessions);
    return session;
  }

  async remove(id: string): Promise<BrowserSession | undefined> {
    const sessions = await this.load();
    const existing = sessions[id];
    if (!existing) return undefined;
    delete sessions[id];
    await this.save(sessions);
    return existing;
  }

  private async load(): Promise<Record<string, BrowserSession>> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const value = JSON.parse(raw) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      return value as Record<string, BrowserSession>;
    } catch {
      return {};
    }
  }

  private async save(sessions: Record<string, BrowserSession>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(sessions, null, 2) + "\n", "utf8");
  }
}

export class BrowserLauncher {
  async launch(input: {
    endpoint: string;
    userDataDir: string;
    executable?: string;
    url?: string;
  }): Promise<BrowserLaunchResult> {
    const endpoint = input.endpoint.replace(/\/+$/, "");
    if (!isLoopbackEndpoint(endpoint)) {
      throw new Error("Browser launcher only permits loopback CDP endpoints.");
    }

    try {
      const response = await fetch(endpoint + "/json/version");
      if (response.ok) {
        return {
          started: false,
          reused: true,
          endpoint,
          message: "A browser is already reachable at the requested CDP endpoint."
        };
      }
    } catch {
      // No existing browser; continue with launch.
    }

    const executable = input.executable ?? this.resolveExecutable();
    const url = new URL(endpoint);
    const port = url.port;
    if (!port) throw new Error("CDP endpoint must include an explicit port.");

    const args = [
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=" + port,
      "--user-data-dir=" + input.userDataDir,
      "--no-first-run",
      "--no-default-browser-check"
    ];
    if (input.url) args.push(input.url);

    const child = spawn(executable, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();

    await waitForEndpoint(endpoint, 15_000);

    return {
      started: true,
      reused: false,
      endpoint,
      ...(child.pid ? { pid: child.pid } : {}),
      executable,
      message: "Browser launched with a persistent user-data directory and loopback CDP endpoint."
    };
  }

  private resolveExecutable(): string {
    const envExecutable = process.env.BROWSER_EXECUTABLE?.trim();
    if (envExecutable) return envExecutable;

    const candidates = process.platform === "win32"
      ? [
          process.env.LOCALAPPDATA
            ? process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe"
            : "",
          process.env.PROGRAMFILES
            ? process.env.PROGRAMFILES + "\\Google\\Chrome\\Application\\chrome.exe"
            : "",
          process.env.LOCALAPPDATA
            ? process.env.LOCALAPPDATA + "\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
            : "",
          "chrome.exe",
          "msedge.exe",
          "brave.exe"
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "google-chrome",
            "brave",
            "chromium"
          ]
        : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "brave", "microsoft-edge"];

    for (const candidate of candidates) {
      if (!candidate) continue;
      if (candidate.includes("/") || candidate.includes("\\") || candidate.endsWith(".exe")) {
        if (existsSync(candidate)) return candidate;
        continue;
      }
      const result = spawnSync(
        process.platform === "win32" ? "where" : "which",
        [candidate],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      );
      if (result.status === 0 && result.stdout.trim()) return result.stdout.trim().split(/\r?\n/)[0]!;
    }

    throw new Error("No supported Chromium-based browser executable was found. Pass executable or set BROWSER_EXECUTABLE.");
  }
}

function isLoopbackEndpoint(endpoint: string): boolean {
  const url = new URL(endpoint);
  return url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
}

async function waitForEndpoint(endpoint: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "browser did not become ready";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint + "/json/version");
      if (response.ok) return;
      lastError = "CDP HTTP " + response.status;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Timed out waiting for browser CDP endpoint: " + lastError);
}
