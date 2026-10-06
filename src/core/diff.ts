import { createHash } from "node:crypto";
import type {
  AccessibilityNode,
  Observation,
  ObservationDiff,
  Rect,
  WindowInfo,
  EntityDiff,
  ScreenshotDiff
} from "../types.js";

export function observationDiff(
  previous: Observation | undefined,
  current: Observation
): ObservationDiff {
  if (!previous) {
    const currentFingerprint = screenshotFingerprint(current);
    return {
      hasPrevious: false,
      changed: false,
      changedFields: [],
      activeWindowChanged: false,
      displaysChanged: false,
      windows: emptyEntityDiff(),
      accessibility: emptyEntityDiff(),
      screenshot: {
        changed: false,
        ...(currentFingerprint ? { currentSha256: currentFingerprint.sha256 } : {}),
        ...(screenshotDimensions(current)
          ? { currentDimensions: screenshotDimensions(current) }
          : {})
      }
    };
  }

  const windows = diffById(previous.windows, current.windows, stableWindow);
  const accessibility = diffAccessibility(
    previous.accessibility ?? [],
    current.accessibility ?? []
  );
  const activeWindowChanged =
    stableValue(previous.activeWindow ?? null) !==
    stableValue(current.activeWindow ?? null);
  const displaysChanged =
    stableValue(previous.displays) !== stableValue(current.displays);
  const screenshot = diffScreenshots(previous, current);

  const changedFields: string[] = [];
  if (activeWindowChanged) changedFields.push("active_window");
  if (displaysChanged) changedFields.push("displays");
  if (
    windows.addedIds.length ||
    windows.removedIds.length ||
    windows.changedIds.length
  ) {
    changedFields.push("windows");
  }
  if (
    accessibility.addedIds.length ||
    accessibility.removedIds.length ||
    accessibility.changedIds.length
  ) {
    changedFields.push("accessibility");
  }
  if (screenshot.changed) changedFields.push("screenshot");

  return {
    hasPrevious: true,
    changed: changedFields.length > 0,
    changedFields,
    activeWindowChanged,
    displaysChanged,
    windows,
    accessibility,
    screenshot
  };
}

export function screenshotFingerprint(
  observation: Observation
): { sha256: string } | undefined {
  const screenshot = observation.screenshot;
  if (!screenshot) return undefined;

  if (screenshot.data !== undefined) {
    return {
      sha256: createHash("sha256")
        .update(Buffer.from(screenshot.data, "base64"))
        .digest("hex")
    };
  }

  if (screenshot.uri) {
    if (screenshot.uri.startsWith("sha256:")) {
      return { sha256: screenshot.uri.slice("sha256:".length) };
    }
    return {
      sha256: createHash("sha256")
        .update("uri:" + screenshot.uri)
        .digest("hex")
    };
  }

  return undefined;
}

function screenshotDimensions(observation: Observation) {
  return observation.screenshot
    ? {
        width: observation.screenshot.width,
        height: observation.screenshot.height
      }
    : undefined;
}

function diffScreenshots(
  previous: Observation,
  current: Observation
): ScreenshotDiff {
  const previousFingerprint = screenshotFingerprint(previous);
  const currentFingerprint = screenshotFingerprint(current);
  const previousDimensions = screenshotDimensions(previous);
  const currentDimensions = screenshotDimensions(current);

  const changed =
    previousFingerprint?.sha256 !== currentFingerprint?.sha256 ||
    stableValue(previousDimensions ?? null) !==
      stableValue(currentDimensions ?? null);

  return {
    changed,
    ...(previousFingerprint ? { previousSha256: previousFingerprint.sha256 } : {}),
    ...(currentFingerprint ? { currentSha256: currentFingerprint.sha256 } : {}),
    ...(previousDimensions ? { previousDimensions } : {}),
    ...(currentDimensions ? { currentDimensions } : {})
  };
}

function diffById<T extends { id: string }>(
  previous: T[],
  current: T[],
  normalize: (value: T) => unknown
): EntityDiff {
  const prev = new Map(
    previous.map((item) => [item.id, stableValue(normalize(item))])
  );
  const next = new Map(
    current.map((item) => [item.id, stableValue(normalize(item))])
  );

  const addedIds: string[] = [];
  const removedIds: string[] = [];
  const changedIds: string[] = [];

  for (const id of next.keys()) {
    if (!prev.has(id)) addedIds.push(id);
    else if (prev.get(id) !== next.get(id)) changedIds.push(id);
  }
  for (const id of prev.keys()) {
    if (!next.has(id)) removedIds.push(id);
  }

  return {
    addedIds: addedIds.slice(0, 100),
    removedIds: removedIds.slice(0, 100),
    changedIds: changedIds.slice(0, 100)
  };
}

function diffAccessibility(
  previous: AccessibilityNode[],
  current: AccessibilityNode[]
): EntityDiff {
  const flatten = (roots: AccessibilityNode[]) => {
    const output: AccessibilityNode[] = [];
    const visit = (node: AccessibilityNode) => {
      output.push(node);
      for (const child of node.children ?? []) visit(child);
    };
    for (const root of roots) visit(root);
    return output;
  };

  return diffById(
    flatten(previous),
    flatten(current),
    stableAccessibilityNode
  );
}

function stableWindow(window: WindowInfo) {
  return {
    id: window.id,
    title: window.title,
    appName: window.appName,
    bounds: normalizeRect(window.bounds),
    focused: window.focused,
    minimized: window.minimized
  };
}

function stableAccessibilityNode(node: AccessibilityNode) {
  return {
    id: node.id,
    role: node.role,
    name: node.name,
    value: node.value,
    automationId: node.automationId,
    className: node.className,
    patterns: node.patterns,
    bounds: normalizeRect(node.bounds),
    enabled: node.enabled,
    focused: node.focused
  };
}

function normalizeRect(rect: Rect | undefined) {
  return rect
    ? {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }
    : null;
}

function stableValue(value: unknown): string {
  return JSON.stringify(value);
}

function emptyEntityDiff(): EntityDiff {
  return { addedIds: [], removedIds: [], changedIds: [] };
}
