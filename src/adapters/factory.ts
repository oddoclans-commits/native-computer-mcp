import type { ComputerAdapter } from "../types.js";
import { LinuxX11Adapter } from "./linux-x11.js";
import { UnavailableAdapter } from "./unavailable.js";
import { WindowsAdapter } from "./windows.js";

export function createDefaultAdapter(): ComputerAdapter {
  switch (process.platform) {
    case "win32":
      return new WindowsAdapter();
    case "linux":
      return new LinuxX11Adapter();
    default:
      return new UnavailableAdapter();
  }
}
