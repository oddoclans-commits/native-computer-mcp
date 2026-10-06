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

export type Action =
  | { type: "click"; point: Point; button?: "left" | "middle" | "right" }
  | { type: "type"; text: string }
  | { type: "key"; key: string; modifiers?: string[] }
  | { type: "scroll"; deltaX?: number; deltaY: number }
  | { type: "drag"; from: Point; to: Point; durationMs?: number }
  | { type: "set_value"; targetId: string; value: string }
  | { type: "secondary_action"; targetId: string }
  | { type: "activate_window"; windowId: string };

export interface ActionRequest {
  observationId?: string;
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
}

export interface AdapterStatus {
  ready: boolean;
  capabilities: string[];
  message?: string;
  details?: Record<string, unknown>;
}

export interface ComputerAdapter {
  readonly platform: Platform;
  readonly name: string;

  status(): Promise<AdapterStatus>;
  start(): Promise<void>;
  observe(): Promise<Observation>;
  act(request: ActionRequest): Promise<ActionResult>;
  stop(): Promise<void>;
}

export interface RuntimeSession {
  id: string;
  createdAt: string;
  active: boolean;
  observationId?: string;
}
