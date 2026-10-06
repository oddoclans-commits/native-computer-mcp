import type { ComputerAdapter } from "../types.js";
import { LinuxX11Adapter } from "./linux-x11.js";
import { UnavailableAdapter } from "./unavailable.js";
import { WindowsAdapter } from "./windows.js";
import { MacOSAXAdapter } from "./macos-ax.js";
import { LinuxAtspiAdapter } from "./linux-atspi.js";
import { LinuxWaylandAdapter } from "./linux-wayland.js";

export function createDefaultAdapter(): ComputerAdapter {
  switch (process.platform) {
    case "win32":
      return new WindowsAdapter();
    case "linux":
      return process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland"
        ? new LinuxWaylandAdapter()
        : new LinuxAtspiAdapter();
    case "darwin":
      return new MacOSAXAdapter();
    default:
      return new UnavailableAdapter();
  }
}
