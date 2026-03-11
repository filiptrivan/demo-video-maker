export interface DemoConfig {
  prompt: string;
  width: number;
  height: number;
  fps: number;
  outputPath: string;
  model: string;
  zoomFactor: number;
  debug: boolean;
  useCli: boolean;
}

export interface ActionPlan {
  actions: Action[];
  metadata: { title: string; description: string };
}

export type Action =
  | { type: 'open_app'; app: string; description: string }
  | { type: 'click'; target: string; button?: 'left' | 'right'; description: string }
  | { type: 'double_click'; target: string; description: string }
  | { type: 'type'; text: string; target?: string; description: string; pressEnter?: boolean }
  | { type: 'hotkey'; keys: string[]; description: string }
  | { type: 'scroll'; direction: 'up' | 'down'; amount: number; description: string }
  | { type: 'wait'; durationMs: number; description: string }
  | { type: 'navigate'; url: string; description: string };

export interface ScreenCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraKeyframe {
  timestamp: number;
  centerX: number;
  centerY: number;
  zoom: number;
}

export interface RecordingSession {
  videoPath: string;
  cameraKeyframes: CameraKeyframe[];
  durationMs: number;
}

export interface TimedPoint {
  x: number;
  y: number;
  timestamp: number;
}

export interface KeystrokeEvent {
  key: string;
  delayMs: number;
  isCorrection?: boolean;
}

export interface ScrollStep {
  deltaY: number;
  delayMs: number;
}
