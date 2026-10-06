export type Platform = "windows" | "macos" | "linux" | "unknown";
export type RiskTier = "safe" | "sensitive" | "dangerous";
export type SafetyMode = "auto" | "ask" | "deny";

export type ActionStatus = "executed" | "rejected" | "uncertain" | "blocked";
export type VerificationStatus =
  | "not_checked"
  | "confirmed"
  | "changed"
  | "failed"
  | "needs_observation";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: string;
  bounds: Rect;
  scaleFactor?: number;
}

export interface WindowInfo {
  id: string;
  title?: string;
  appName?: string;
  bounds?: Rect;
  focused?: boolean;
  minimized?: boolean;
}

export interface AccessibilityNode {
  id: string;
  role: string;
  name?: string;
  value?: string;
  automationId?: string;
  className?: string;
  patterns?: string[];
  bounds?: Rect;
  enabled?: boolean;
  focused?: boolean;
  children?: AccessibilityNode[];
}

export interface OCRWord {
  text: string;
  bounds: Rect;
  confidence?: number;
}

export interface Observation {
  observationId: string;
  timestamp: string;
  platform: Platform;
  activeWindow?: WindowInfo;
  displays: DisplayInfo[];
  windows: WindowInfo[];
  accessibility?: AccessibilityNode[];
  ocr?: OCRWord[];
  screenshot?: {
    mimeType: string;
    data?: string;
    uri?: string;
    width?: number;
    height?: number;
  };
  capabilities: string[];
}

export interface ScreenshotDiff {
  changed: boolean;
  previousSha256?: string;
  currentSha256?: string;
  previousDimensions?: { width?: number; height?: number };
  currentDimensions?: { width?: number; height?: number };
}

export interface EntityDiff {
  addedIds: string[];
  removedIds: string[];
  changedIds: string[];
}

export interface ObservationDiff {
  hasPrevious: boolean;
  changed: boolean;
  changedFields: string[];
  activeWindowChanged: boolean;
  displaysChanged: boolean;
  windows: EntityDiff;
  accessibility: EntityDiff;
  screenshot: ScreenshotDiff;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface VerificationResult {
  status: VerificationStatus;
  changed?: boolean;
  checks: VerificationCheck[];
  message?: string;
  diff?: ObservationDiff;
}

export type Action =
  | {
      type: "click";
      point?: Point;
      targetId?: string;
      button?: "left" | "middle" | "right";
    }
  | { type: "type"; text: string }
  | { type: "key"; key: string; modifiers?: string[] }
  | { type: "scroll"; deltaX?: number; deltaY: number }
  | { type: "drag"; from: Point; to: Point; durationMs?: number }
  | { type: "set_value"; targetId: string; value: string }
  | { type: "secondary_action"; targetId: string }
  | { type: "activate_window"; windowId: string };

export interface ActionRequest {
  observationId?: string;
  turnId?: string;
  action: Action;
  risk?: RiskTier;
  safetyMode?: SafetyMode;
}

export interface ActionResult {
  status: ActionStatus;
  verification: VerificationStatus;
  message?: string;
  nextObservationRequired?: boolean;
  evidence?: string[];
  traceId?: string;
}

export interface AdapterStatus {
  ready: boolean;
  capabilities: string[];
  message?: string;
  details?: Record<string, unknown>;
}

export interface DialogAdapter {
  selectFile(path: string): Promise<ActionResult>;
  selectFolder(path: string): Promise<ActionResult>;
  setSavePath(path: string): Promise<ActionResult>;
}

export interface BrowserTarget {
  id: string;
  type: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

export interface ComputerAdapter {
  readonly platform: Platform;
  readonly name: string;
  status(): Promise<AdapterStatus>;
  start(): Promise<void>;
  observe(): Promise<Observation>;
  act(request: ActionRequest): Promise<ActionResult>;
  stop(): Promise<void>;
  dialogs?: DialogAdapter;
}

export interface RuntimeSession {
  id: string;
  createdAt: string;
  active: boolean;
  observationId?: string;
}
