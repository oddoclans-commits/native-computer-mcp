import type { CapabilityNegotiation, Platform } from "../types.js";

export function negotiateCapabilities(
  platform: Platform,
  adapterName: string,
  capabilities: string[],
  requested: string[] = []
): CapabilityNegotiation {
  const available = [...new Set(capabilities)];
  const supported = requested.filter((capability) => available.includes(capability));
  const missing = requested.filter((capability) => !available.includes(capability));

  const preferred: Record<string, string> = {};
  const fallbacks: Record<string, string[]> = {};

  const hasSemantic = available.includes("semantic_actions") && available.includes("semantic_targets");
  const hasNativeInput = available.includes("native_input");
  const hasScreenshot = available.includes("screenshot");
  const hasWindows = available.includes("window_discovery");
  const hasAtspi = available.includes("accessibility_atspi");

  preferred.observe = hasSemantic ? "accessibility_tree" : hasScreenshot ? "screenshot" : "adapter_observation";
  preferred.target_discovery = hasSemantic ? "semantic_accessibility" : hasScreenshot ? "visual_coordinates" : "adapter_native_targets";
  preferred.click = hasSemantic ? "semantic_target" : hasNativeInput ? "coordinate_input" : "unavailable";
  preferred.type = hasNativeInput ? "native_keyboard" : "unavailable";
  preferred.scroll = hasNativeInput ? "native_scroll" : "unavailable";
  preferred.screenshot = hasScreenshot ? "native_screenshot" : "unavailable";
  preferred.window_management = hasWindows ? "native_window_manager" : "platform_lifecycle_only";

  fallbacks.observe = [hasScreenshot ? "screenshot" : "", "adapter_observation"].filter(Boolean);
  fallbacks.target_discovery = [
    hasSemantic ? "semantic_accessibility" : "",
    hasAtspi ? "atspi" : "",
    hasScreenshot ? "visual_coordinates" : ""
  ].filter(Boolean);
  fallbacks.click = [
    hasSemantic ? "semantic_target" : "",
    hasNativeInput ? "coordinate_input" : ""
  ].filter(Boolean);
  fallbacks.type = hasNativeInput ? ["native_keyboard"] : [];
  fallbacks.scroll = hasNativeInput ? ["native_scroll"] : [];
  fallbacks.window_management = hasWindows ? ["native_window_manager"] : [];

  const limitations: string[] = [];

  if (!hasSemantic) limitations.push("Semantic accessibility targeting is unavailable; use the visual/coordinate fallback.");
  if (!hasNativeInput) limitations.push("Native OS input is unavailable; mutating computer actions may be blocked.");
  if (!hasScreenshot) limitations.push("Native screenshot capture is unavailable.");
  if (!hasWindows) limitations.push("Universal native window discovery/activation is unavailable on this adapter.");
  if (platform === "linux" && adapterName.includes("wayland")) {
    limitations.push("Wayland window activation remains compositor-specific.");
  }
  if (platform === "macos") {
    limitations.push("macOS runtime control depends on Accessibility/Screen Recording permissions and an interactive user session.");
  }

  return {
    requested: [...requested],
    available,
    supported,
    missing,
    preferred,
    fallbacks,
    limitations
  };
}
