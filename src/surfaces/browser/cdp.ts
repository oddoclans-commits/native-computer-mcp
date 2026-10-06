import { createHash } from "node:crypto";
import WebSocket from "ws";
import { findAccessibilityNodes } from "../../core/query.js";
import type { AccessibilityNode, BrowserTarget } from "../../types.js";

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

export interface BrowserState {
  targetId: string;
  url?: string;
  title?: string;
  readyState?: string;
  textPreview?: string;
  textSha256?: string;
}

export interface BrowserVerificationCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface BrowserVerificationResult {
  status: "confirmed" | "failed" | "not_checked";
  state: BrowserState;
  checks: BrowserVerificationCheck[];
  message: string;
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

  async accessibility(
    targetId: string,
    endpoint = "http://127.0.0.1:9222"
  ): Promise<AccessibilityNode[]> {
    return normalizeCdpAxTree(await this.snapshot(targetId, endpoint));
  }

  async navigate(
    targetId: string,
    url: string,
    endpoint = "http://127.0.0.1:9222"
  ) {
    const connection = await this.connectionFor(targetId, endpoint);
    return this.call(connection, "Page.navigate", { url });
  }

  async state(
    targetId: string,
    endpoint = "http://127.0.0.1:9222"
  ): Promise<BrowserState> {
    const raw = await this.evaluate(targetId, `(() => ({
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      text: (document.body?.innerText || "").slice(0, 100000)
    }))()`, endpoint) as {
      url?: string;
      title?: string;
      readyState?: string;
      text?: string;
    };

    const textValue = raw.text ?? "";
    return {
      targetId,
      ...(raw.url ? { url: raw.url } : {}),
      ...(raw.title !== undefined ? { title: raw.title } : {}),
      ...(raw.readyState ? { readyState: raw.readyState } : {}),
      ...(textValue ? { textPreview: textValue.slice(0, 2000) } : {}),
      textSha256: createHash("sha256").update(textValue).digest("hex")
    };
  }

  async verify(
    targetId: string,
    expect: {
      urlContains?: string;
      titleContains?: string;
      textContains?: string;
      readyStateEquals?: string;
    },
    endpoint = "http://127.0.0.1:9222"
  ): Promise<BrowserVerificationResult> {
    const state = await this.state(targetId, endpoint);
    const checks: BrowserVerificationCheck[] = [];

    if (expect.urlContains !== undefined) {
      const actual = state.url ?? "";
      const needle = expect.urlContains.toLocaleLowerCase();
      checks.push({
        name: "url_contains",
        passed: actual.toLocaleLowerCase().includes(needle),
        message: `current URL is "${actual}"`
      });
    }

    if (expect.titleContains !== undefined) {
      const actual = state.title ?? "";
      const needle = expect.titleContains.toLocaleLowerCase();
      checks.push({
        name: "title_contains",
        passed: actual.toLocaleLowerCase().includes(needle),
        message: `document title is "${actual}"`
      });
    }

    if (expect.textContains !== undefined) {
      const needle = expect.textContains.toLocaleLowerCase();
      const textResult = await this.evaluate(
        targetId,
        "(() => (document.body?.innerText || '').toLocaleLowerCase().includes(" +
          JSON.stringify(needle) +
          "))()",
        endpoint
      ) as boolean;
      checks.push({
        name: "text_contains",
        passed: textResult === true,
        message: `body text contains requested text: ${textResult === true}`
      });
    }

    if (expect.readyStateEquals !== undefined) {
      const actual = state.readyState ?? "";
      checks.push({
        name: "ready_state",
        passed: actual === expect.readyStateEquals,
        message: `document readyState is "${actual}"`
      });
    }

    const passed = checks.length > 0 && checks.every((check) => check.passed);
    return {
      status: checks.length === 0 ? "not_checked" : passed ? "confirmed" : "failed",
      state,
      checks,
      message: passed
        ? "All requested browser verification checks passed."
        : checks.length === 0
          ? "No browser verification checks were requested."
          : "One or more browser verification checks failed."
    };
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

  async find(targetId: string, query: string, role?: string, endpoint = "http://127.0.0.1:9222") {
    const expression =
      "(() => {" +
      "const q=" + JSON.stringify(query.toLowerCase()) + ";" +
      "const role=" + JSON.stringify((role ?? "").toLowerCase()) + ";" +
      "return [...document.querySelectorAll('*')].filter(el => {" +
      "if (role && (el.getAttribute('role') || '').toLowerCase() !== role) return false;" +
      "const text=[el.getAttribute('aria-label')||'',el.textContent||'',el.getAttribute('name')||'',el.id||''].join(' ').toLowerCase();" +
      "return text.includes(q);" +
      "}).slice(0,20).map(el => ({tag:el.tagName,role:el.getAttribute('role'),name:el.getAttribute('aria-label')||el.getAttribute('name'),id:el.id||null,text:(el.textContent||'').trim().slice(0,200)}));" +
      "})()";
    return this.evaluate(targetId, expression, endpoint);
  }

  async clickAccessible(
    targetId: string,
    query: string,
    role?: string,
    endpoint = "http://127.0.0.1:9222"
  ) {
    const tree = await this.accessibility(targetId, endpoint);
    const matches = findAccessibilityNodes(tree, query, role);
    const candidate = matches.find((match) => match.enabled !== false);
    if (!candidate) {
      throw new Error("No enabled browser accessibility target matched \"" + query + "\".");
    }
    if (!candidate.automationId || !/^\d+$/.test(candidate.automationId)) {
      throw new Error("Browser accessibility target \"" + candidate.targetId + "\" has no backend DOM node id.");
    }

    const result = await this.callBackendNode(
      targetId,
      Number(candidate.automationId),
      `function() {
        this.scrollIntoView({block:"center",inline:"center"});
        if (typeof this.click !== "function") {
          throw new Error("Resolved browser accessibility target is not clickable.");
        }
        this.click();
        return {clicked:true};
      }`,
      [],
      endpoint
    );

    return {
      ...result,
      targetId: candidate.targetId,
      query,
      ...(role ? { role } : {}),
      score: candidate.score
    };
  }

  async typeAccessible(
    targetId: string,
    query: string,
    value: string,
    role?: string,
    endpoint = "http://127.0.0.1:9222"
  ) {
    const tree = await this.accessibility(targetId, endpoint);
    const matches = findAccessibilityNodes(tree, query, role);
    const candidate = matches.find((match) => match.enabled !== false);
    if (!candidate) {
      throw new Error("No enabled browser accessibility target matched \"" + query + "\".");
    }
    if (!candidate.automationId || !/^\d+$/.test(candidate.automationId)) {
      throw new Error("Browser accessibility target \"" + candidate.targetId + "\" has no backend DOM node id.");
    }

    const result = await this.callBackendNode(
      targetId,
      Number(candidate.automationId),
      `function(value) {
        this.scrollIntoView({block:"center",inline:"center"});
        if ("value" in this) {
          this.focus();
          this.value = value;
          this.dispatchEvent(new Event("input",{bubbles:true}));
          this.dispatchEvent(new Event("change",{bubbles:true}));
        } else if (this.isContentEditable) {
          this.focus();
          this.textContent = value;
          this.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:value}));
        } else {
          throw new Error("Resolved browser accessibility target is not editable.");
        }
        return {typed:true,length:value.length};
      }`,
      [{ value: value }],
      endpoint
    );

    return {
      ...result,
      targetId: candidate.targetId,
      query,
      ...(role ? { role } : {}),
      score: candidate.score
    };
  }

  async clickSelector(targetId: string, selector: string, endpoint = "http://127.0.0.1:9222") {
    const expression =
      "(() => {" +
      "const selector=" + JSON.stringify(selector) + ";" +
      "const el=document.querySelector(selector);" +
      "if(!el) throw new Error('Browser selector not found: '+selector);" +
      "el.scrollIntoView({block:'center',inline:'center'});" +
      "el.click();" +
      "return {clicked:true,selector};" +
      "})()";
    return this.evaluate(targetId, expression, endpoint);
  }

  async typeSelector(targetId: string, selector: string, value: string, endpoint = "http://127.0.0.1:9222") {
    const expression =
      "(() => {" +
      "const selector=" + JSON.stringify(selector) + ";" +
      "const value=" + JSON.stringify(value) + ";" +
      "const el=document.querySelector(selector);" +
      "if(!el) throw new Error('Browser selector not found: '+selector);" +
      "el.focus();" +
      "if('value' in el){el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}" +
      "else{el.textContent=value;}" +
      "return {typed:true,selector,length:value.length};" +
      "})()";
    return this.evaluate(targetId, expression, endpoint);
  }

  async disconnect(targetId: string): Promise<void> {
    const connection = this.connections.get(targetId);
    if (!connection) return;
    connection.socket.close();
    this.connections.delete(targetId);
  }

  async close(): Promise<void> {
    for (const targetId of [...this.connections.keys()]) {
      await this.disconnect(targetId);
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

  private async callBackendNode(
    targetId: string,
    backendNodeId: number,
    functionDeclaration: string,
    argumentsList: Array<{ value: string }> = [],
    endpoint = "http://127.0.0.1:9222"
  ) {
    const connection = await this.connectionFor(targetId, endpoint);
    const resolved = await this.call(connection, "DOM.resolveNode", { backendNodeId }) as {
      object?: { objectId?: string };
    };
    const objectId = resolved.object?.objectId;
    if (!objectId) throw new Error("CDP did not resolve the backend DOM node.");

    return this.call(connection, "Runtime.callFunctionOn", {
      objectId,
      functionDeclaration,
      arguments: argumentsList,
      returnByValue: true,
      awaitPromise: true
    }) as Promise<Record<string, unknown>>;
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


export function normalizeCdpAxTree(value: unknown): AccessibilityNode[] {
  const source = value as { nodes?: unknown[] } | null;
  const nodes = Array.isArray(source?.nodes) ? source.nodes : [];
  const byId = new Map<string, AccessibilityNode>();
  const childrenById = new Map<string, string[]>();

  for (const raw of nodes) {
    const node = raw as Record<string, unknown>;
    const id = typeof node.nodeId === "string" ? node.nodeId : undefined;
    if (!id) continue;

    const role = axString(node.role) ?? "unknown";
    const name = axValue(node.name);
    const currentValue = axValue(node.value);
    const backendId =
      typeof node.backendDOMNodeId === "number"
        ? String(node.backendDOMNodeId)
        : undefined;
    const properties = Array.isArray(node.properties) ? node.properties : [];
    const focused = axPropertyBoolean(properties, "focused");
    const disabled = axPropertyBoolean(properties, "disabled");

    const normalized: AccessibilityNode = {
      id: "cdp:" + id,
      role,
      ...(name ? { name } : {}),
      ...(currentValue ? { value: currentValue } : {}),
      ...(backendId ? { automationId: backendId } : {}),
      ...(focused !== undefined ? { focused } : {}),
      ...(disabled !== undefined ? { enabled: !disabled } : {})
    };

    byId.set(id, normalized);

    const childIds = Array.isArray(node.childIds)
      ? node.childIds.filter((child): child is string => typeof child === "string")
      : [];
    if (childIds.length) childrenById.set(id, childIds);
  }

  const referenced = new Set<string>();
  for (const ids of childrenById.values()) {
    for (const id of ids) referenced.add(id);
  }

  const attachChildren = (id: string, path: Set<string>): AccessibilityNode | undefined => {
    const base = byId.get(id);
    if (!base || path.has(id)) return base;

    const nextPath = new Set(path);
    nextPath.add(id);

    const childIds = childrenById.get(id) ?? [];
    const children = childIds
      .map((childId) => attachChildren(childId, nextPath))
      .filter((child): child is AccessibilityNode => child !== undefined);

    return children.length ? { ...base, children } : { ...base };
  };

  const roots = [...byId.keys()]
    .filter((id) => !referenced.has(id))
    .slice(0, 20)
    .map((id) => attachChildren(id, new Set()))
    .filter((node): node is AccessibilityNode => node !== undefined);

  return roots.length ? roots : [...byId.values()].slice(0, 500);
}

function axString(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.value === "string" ? record.value : undefined;
}

function axValue(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.value === "string") return record.value;
  if (typeof record.value === "number" || typeof record.value === "boolean") {
    return String(record.value);
  }
  return undefined;
}

function axPropertyBoolean(properties: unknown[], name: string): boolean | undefined {
  for (const property of properties) {
    if (!property || typeof property !== "object") continue;
    const record = property as Record<string, unknown>;
    if (record.name !== name) continue;
    return axValue(record.value) === "true";
  }
  return undefined;
}
