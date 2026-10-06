import { createHash } from "node:crypto";
import { observationDiff } from "./diff.js";
import type { Observation, VerificationCheck, VerificationResult } from "../types.js";
import { findAccessibilityNodes } from "./query.js";

export interface VerificationSpec {
  activeWindowTitleContains?: string;
  activeAppNameEquals?: string;
  windowTitleContains?: string;
  targetQuery?: string;
  targetRole?: string;
  expectChanged?: boolean;
  includeDiff?: boolean;
}

export function observationFingerprint(observation: Observation): string {
  const stable = {
    platform: observation.platform,
    activeWindow: observation.activeWindow
      ? {
          id: observation.activeWindow.id,
          title: observation.activeWindow.title,
          appName: observation.activeWindow.appName,
          bounds: observation.activeWindow.bounds
        }
      : null,
    displays: observation.displays,
    windows: observation.windows.map((window) => ({
      id: window.id,
      title: window.title,
      appName: window.appName,
      bounds: window.bounds,
      focused: window.focused,
      minimized: window.minimized
    })),
    accessibility: observation.accessibility ?? [],
    screenshot: observation.screenshot?.uri ?? null
  };

  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function verifyObservation(
  observation: Observation,
  previousObservation: Observation | undefined,
  spec: VerificationSpec = {}
): VerificationResult {
  const checks: VerificationCheck[] = [];
  const diff = previousObservation
    ? observationDiff(previousObservation, observation)
    : undefined;
  const changed = diff?.changed ?? false;

  if (spec.activeWindowTitleContains !== undefined) {
    const actual = observation.activeWindow?.title ?? "";
    const needle = spec.activeWindowTitleContains.toLocaleLowerCase();
    checks.push({
      name: "active_window_title",
      passed: actual.toLocaleLowerCase().includes(needle),
      message: `active window title is "${actual}"`
    });
  }

  if (spec.activeAppNameEquals !== undefined) {
    const actual = observation.activeWindow?.appName ?? "";
    checks.push({
      name: "active_app_name",
      passed:
        actual.toLocaleLowerCase() ===
        spec.activeAppNameEquals.toLocaleLowerCase(),
      message: `active app is "${actual}"`
    });
  }

  if (spec.windowTitleContains !== undefined) {
    const needle = spec.windowTitleContains.toLocaleLowerCase();
    const found = observation.windows.some((window) =>
      (window.title ?? "").toLocaleLowerCase().includes(needle)
    );
    checks.push({
      name: "window_title",
      passed: found,
      message: found ? "matching window found" : "matching window not found"
    });
  }

  if (spec.targetQuery !== undefined) {
    const matches = findAccessibilityNodes(
      observation.accessibility ?? [],
      spec.targetQuery,
      spec.targetRole
    );
    checks.push({
      name: "semantic_target",
      passed: matches.length > 0,
      message:
        matches.length > 0
          ? `found ${matches.length} matching target(s)`
          : "no matching target found"
    });
  }

  if (spec.expectChanged !== undefined) {
    checks.push({
      name: "observation_changed",
      passed: changed === spec.expectChanged,
      message:
        previousFingerprint === undefined
          ? "no previous observation fingerprint is available"
          : changed
            ? "observation changed"
            : "observation did not change"
    });
  }

  const passed = checks.length > 0 && checks.every((check) => check.passed);
  const status =
    checks.length === 0
      ? "not_checked"
      : passed
        ? spec.expectChanged === true
          ? "changed"
          : "confirmed"
        : "failed";

  return {
    status,
    changed,
    checks,
    message: passed
      ? "All requested verification checks passed."
      : "One or more verification checks failed.",
    ...(diff && (spec.includeDiff || spec.expectChanged !== undefined)
      ? { diff }
      : {})
  };
}
