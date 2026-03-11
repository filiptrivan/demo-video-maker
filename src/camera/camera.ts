import type { CameraKeyframe, Action, ScreenCoordinates } from '../types.js';
import { easeInOutCubic, clamp, lerp } from '../motion/easing.js';

export class CameraTracker {
  private keyframes: CameraKeyframe[] = [];
  private screenWidth: number;
  private screenHeight: number;
  private maxZoom: number;
  private currentZoom: number = 1.0;

  constructor(screenWidth: number, screenHeight: number, maxZoom: number = 1.5) {
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;
    this.maxZoom = maxZoom;

    // Initial keyframe: full screen, no zoom
    this.keyframes.push({
      timestamp: 0,
      centerX: screenWidth / 2,
      centerY: screenHeight / 2,
      zoom: 1.0,
    });
  }

  addKeyframe(timestamp: number, action: Action, coords?: ScreenCoordinates): void {
    let centerX = this.screenWidth / 2;
    let centerY = this.screenHeight / 2;
    let zoom = this.currentZoom;

    switch (action.type) {
      case 'click':
      case 'double_click':
      case 'type': {
        if (coords) {
          centerX = coords.x + coords.width / 2;
          centerY = coords.y + coords.height / 2;
          // Zoom in on small targets
          const targetSize = Math.max(coords.width, coords.height);
          if (targetSize < 200) {
            zoom = this.maxZoom;
          } else if (targetSize < 400) {
            zoom = lerp(1.0, this.maxZoom, 0.5);
          } else {
            zoom = 1.0;
          }
        }
        break;
      }
      case 'scroll':
      case 'navigate':
      case 'open_app':
        // Zoom out for broad actions
        zoom = 1.0;
        centerX = this.screenWidth / 2;
        centerY = this.screenHeight / 2;
        break;
      case 'hotkey':
      case 'wait':
        // Maintain current zoom
        break;
    }

    // Clamp center to keep the zoomed view within screen bounds
    const halfViewW = this.screenWidth / (2 * zoom);
    const halfViewH = this.screenHeight / (2 * zoom);
    centerX = clamp(centerX, halfViewW, this.screenWidth - halfViewW);
    centerY = clamp(centerY, halfViewH, this.screenHeight - halfViewH);

    this.currentZoom = zoom;

    this.keyframes.push({ timestamp, centerX, centerY, zoom });
  }

  getSmoothedKeyframes(transitionMs: number = 400): CameraKeyframe[] {
    if (this.keyframes.length <= 1) return [...this.keyframes];

    const smoothed: CameraKeyframe[] = [];

    for (let i = 0; i < this.keyframes.length; i++) {
      const kf = this.keyframes[i];
      smoothed.push(kf);

      // Add transition frames between keyframes
      if (i < this.keyframes.length - 1) {
        const next = this.keyframes[i + 1];
        const gap = next.timestamp - kf.timestamp;

        if (gap > transitionMs * 2) {
          const steps = Math.ceil(transitionMs / 16); // ~60fps interpolation
          for (let s = 1; s <= steps; s++) {
            const t = easeInOutCubic(s / steps);
            const interpTimestamp = kf.timestamp + (transitionMs * s) / steps;
            smoothed.push({
              timestamp: interpTimestamp,
              centerX: lerp(kf.centerX, next.centerX, t),
              centerY: lerp(kf.centerY, next.centerY, t),
              zoom: lerp(kf.zoom, next.zoom, t),
            });
          }
        }
      }
    }

    return smoothed;
  }

  getRawKeyframes(): CameraKeyframe[] {
    return [...this.keyframes];
  }
}
