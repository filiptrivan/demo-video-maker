import {
  mouse,
  keyboard,
  screen,
  Button,
  Key,
  Point,
} from '@nut-tree-fork/nut-js';
import sharp from 'sharp';
import type {
  Action,
  ActionPlan,
  RecordingSession,
  ScreenCoordinates,
} from '../types.js';
import { VisionLocator } from '../vision/vision.js';
import { Recorder } from '../recorder/recorder.js';
import { CameraTracker } from '../camera/camera.js';
import { generateMousePath } from '../motion/mouse.js';
import { generateTypingSequence } from '../motion/keyboard.js';
import { generateScrollSteps } from '../motion/scroll.js';
import { openApp } from '../utils/platform.js';
import { sleep } from '../utils/sleep.js';
import { debug, info, warn } from '../utils/logger.js';

// Map string key names to nut-js Key enum
const KEY_MAP: Record<string, number> = {
  control: Key.LeftControl,
  ctrl: Key.LeftControl,
  alt: Key.LeftAlt,
  shift: Key.LeftShift,
  meta: Key.LeftSuper,
  super: Key.LeftSuper,
  win: Key.LeftSuper,
  command: Key.LeftSuper,
  enter: Key.Enter,
  return: Key.Enter,
  tab: Key.Tab,
  escape: Key.Escape,
  esc: Key.Escape,
  backspace: Key.Backspace,
  delete: Key.Delete,
  space: Key.Space,
  up: Key.Up,
  down: Key.Down,
  left: Key.Left,
  right: Key.Right,
  home: Key.Home,
  end: Key.End,
  pageup: Key.PageUp,
  pagedown: Key.PageDown,
  f1: Key.F1,
  f2: Key.F2,
  f3: Key.F3,
  f4: Key.F4,
  f5: Key.F5,
  f6: Key.F6,
  f7: Key.F7,
  f8: Key.F8,
  f9: Key.F9,
  f10: Key.F10,
  f11: Key.F11,
  f12: Key.F12,
  a: Key.A, b: Key.B, c: Key.C, d: Key.D, e: Key.E, f: Key.F,
  g: Key.G, h: Key.H, i: Key.I, j: Key.J, k: Key.K, l: Key.L,
  m: Key.M, n: Key.N, o: Key.O, p: Key.P, q: Key.Q, r: Key.R,
  s: Key.S, t: Key.T, u: Key.U, v: Key.V, w: Key.W, x: Key.X,
  y: Key.Y, z: Key.Z,
  '0': Key.Num0, '1': Key.Num1, '2': Key.Num2, '3': Key.Num3,
  '4': Key.Num4, '5': Key.Num5, '6': Key.Num6, '7': Key.Num7,
  '8': Key.Num8, '9': Key.Num9,
};

function resolveKey(name: string): number {
  const key = KEY_MAP[name.toLowerCase()];
  if (key === undefined) {
    throw new Error(`Unknown key: ${name}`);
  }
  return key;
}

export class Executor {
  private vision: VisionLocator;
  private recorder: Recorder;
  private camera: CameraTracker;
  private currentX: number = 0;
  private currentY: number = 0;
  private startTime: number = 0;

  constructor(
    private config: {
      model: string;
      fps: number;
      screenWidth: number;
      screenHeight: number;
      zoomFactor: number;
      debug: boolean;
      useCli?: boolean;
    }
  ) {
    this.vision = new VisionLocator({ model: config.model, useCli: config.useCli });
    this.recorder = new Recorder(config.fps);
    this.camera = new CameraTracker(config.screenWidth, config.screenHeight, config.zoomFactor);

    // Configure nut-js for smoother operation
    mouse.config.autoDelayMs = 0;
    mouse.config.mouseSpeed = 2000;
    keyboard.config.autoDelayMs = 0;
  }

  async execute(plan: ActionPlan): Promise<RecordingSession> {
    info(`Executing plan: ${plan.metadata.title}`);
    info(`Total actions: ${plan.actions.length}`);

    // Start recording
    const videoPath = this.recorder.start();
    this.startTime = Date.now();

    // Small delay to let FFmpeg initialize
    await sleep(500);

    // Get initial mouse position
    const mousePos = await mouse.getPosition();
    this.currentX = mousePos.x;
    this.currentY = mousePos.y;

    // Execute each action
    for (let i = 0; i < plan.actions.length; i++) {
      const action = plan.actions[i];
      info(`[${i + 1}/${plan.actions.length}] ${action.description}`);

      try {
        await this.executeAction(action);
      } catch (err) {
        warn(`Action failed: ${action.description}`, err);
        // Continue with next action rather than aborting
      }

      // Small settle delay between actions
      await sleep(300);
    }

    // Stop recording
    const result = await this.recorder.stop();

    return {
      videoPath: result.videoPath,
      cameraKeyframes: this.camera.getSmoothedKeyframes(),
      durationMs: result.durationMs,
    };
  }

  private async executeAction(action: Action): Promise<void> {
    switch (action.type) {
      case 'open_app':
        await this.executeOpenApp(action);
        break;
      case 'click':
        await this.executeClick(action);
        break;
      case 'double_click':
        await this.executeDoubleClick(action);
        break;
      case 'type':
        await this.executeType(action);
        break;
      case 'hotkey':
        await this.executeHotkey(action);
        break;
      case 'scroll':
        await this.executeScroll(action);
        break;
      case 'wait':
        await this.executeWait(action);
        break;
      case 'navigate':
        await this.executeNavigate(action);
        break;
    }
  }

  private async executeOpenApp(action: Extract<Action, { type: 'open_app' }>): Promise<void> {
    await openApp(action.app);
    this.camera.addKeyframe(this.elapsed(), action);
    await sleep(1500); // Wait for app to start
  }

  private async executeClick(action: Extract<Action, { type: 'click' }>): Promise<void> {
    const coords = await this.findElement(action.target);
    this.camera.addKeyframe(this.elapsed(), action, coords);

    // Move mouse to center of element
    const targetX = coords.x + coords.width / 2;
    const targetY = coords.y + coords.height / 2;
    await this.moveMouseTo(targetX, targetY, coords.width);

    // Click
    const button = action.button === 'right' ? Button.RIGHT : Button.LEFT;
    await mouse.click(button);

    await sleep(200);
  }

  private async executeDoubleClick(action: Extract<Action, { type: 'double_click' }>): Promise<void> {
    const coords = await this.findElement(action.target);
    this.camera.addKeyframe(this.elapsed(), action, coords);

    const targetX = coords.x + coords.width / 2;
    const targetY = coords.y + coords.height / 2;
    await this.moveMouseTo(targetX, targetY, coords.width);

    await mouse.doubleClick(Button.LEFT);
    await sleep(200);
  }

  private async executeType(action: Extract<Action, { type: 'type' }>): Promise<void> {
    // If there's a target, click it first
    if (action.target) {
      const coords = await this.findElement(action.target);
      this.camera.addKeyframe(this.elapsed(), action, coords);

      const targetX = coords.x + coords.width / 2;
      const targetY = coords.y + coords.height / 2;
      await this.moveMouseTo(targetX, targetY, coords.width);
      await mouse.click(Button.LEFT);
      await sleep(200);
    } else {
      this.camera.addKeyframe(this.elapsed(), action);
    }

    // Type with human-like delays
    const sequence = generateTypingSequence(action.text);
    for (const event of sequence) {
      await sleep(event.delayMs);
      if (event.key === 'Backspace') {
        await keyboard.pressKey(Key.Backspace);
        await keyboard.releaseKey(Key.Backspace);
      } else {
        await keyboard.type(event.key);
      }
    }

    // Press Enter if specified
    if (action.pressEnter) {
      await sleep(150);
      await keyboard.pressKey(Key.Enter);
      await keyboard.releaseKey(Key.Enter);
    }

    await sleep(200);
  }

  private async executeHotkey(action: Extract<Action, { type: 'hotkey' }>): Promise<void> {
    this.camera.addKeyframe(this.elapsed(), action);

    const keys = action.keys.map(resolveKey);

    // Press all keys down
    for (const key of keys) {
      await keyboard.pressKey(key);
      await sleep(50);
    }

    // Release all keys in reverse order
    for (const key of keys.reverse()) {
      await keyboard.releaseKey(key);
      await sleep(50);
    }

    await sleep(300);
  }

  private async executeScroll(action: Extract<Action, { type: 'scroll' }>): Promise<void> {
    this.camera.addKeyframe(this.elapsed(), action);

    const steps = generateScrollSteps(action.amount, action.direction);
    for (const step of steps) {
      await mouse.scrollDown(step.deltaY);
      await sleep(step.delayMs);
    }

    await sleep(200);
  }

  private async executeWait(action: Extract<Action, { type: 'wait' }>): Promise<void> {
    this.camera.addKeyframe(this.elapsed(), action);
    await sleep(action.durationMs);
  }

  private async executeNavigate(action: Extract<Action, { type: 'navigate' }>): Promise<void> {
    this.camera.addKeyframe(this.elapsed(), action);

    // Use the address bar to navigate: click it, clear, type URL, enter
    // First try to find the address bar
    try {
      const coords = await this.findElement('the browser address bar or URL bar');
      const targetX = coords.x + coords.width / 2;
      const targetY = coords.y + coords.height / 2;
      await this.moveMouseTo(targetX, targetY, coords.width);
      await mouse.click(Button.LEFT);
      await sleep(200);

      // Select all and type URL
      await keyboard.pressKey(Key.LeftControl);
      await keyboard.pressKey(Key.A);
      await keyboard.releaseKey(Key.A);
      await keyboard.releaseKey(Key.LeftControl);
      await sleep(100);

      // Type URL quickly (less human-like for URLs)
      await keyboard.type(action.url);
      await sleep(100);
      await keyboard.pressKey(Key.Enter);
      await keyboard.releaseKey(Key.Enter);
    } catch {
      // Fallback: just use hotkey to focus address bar
      await keyboard.pressKey(Key.LeftControl);
      await keyboard.pressKey(Key.L);
      await keyboard.releaseKey(Key.L);
      await keyboard.releaseKey(Key.LeftControl);
      await sleep(300);
      await keyboard.type(action.url);
      await sleep(100);
      await keyboard.pressKey(Key.Enter);
      await keyboard.releaseKey(Key.Enter);
    }

    await sleep(1500); // Wait for page to load
  }

  private async moveMouseTo(targetX: number, targetY: number, targetWidth?: number): Promise<void> {
    const path = generateMousePath(
      { x: this.currentX, y: this.currentY },
      { x: targetX, y: targetY },
      targetWidth
    );

    for (const point of path) {
      await mouse.setPosition(new Point(Math.round(point.x), Math.round(point.y)));
      // Delay between points is encoded in the timestamp differences
      if (path.indexOf(point) > 0) {
        const prevPoint = path[path.indexOf(point) - 1];
        const delay = point.timestamp - prevPoint.timestamp;
        if (delay > 0) {
          await sleep(delay);
        }
      }
    }

    this.currentX = targetX;
    this.currentY = targetY;
  }

  private async findElement(target: string): Promise<ScreenCoordinates> {
    info(`  [Vision] Looking for: "${target}"...`);
    const screenshotImage = await screen.grab();
    const width = screenshotImage.width;
    const height = screenshotImage.height;

    // Convert nut-js image to PNG buffer using sharp
    // grab() returns BGRA data with 4 channels
    const rgbImage = await screenshotImage.toRGB();
    const pngBuffer = await sharp(Buffer.from(rgbImage.data), {
      raw: { width, height, channels: 4 },
    })
      .png()
      .toBuffer();

    const base64 = pngBuffer.toString('base64');

    const coords = await this.vision.locateWithRetry(base64, target);
    info(`  [Vision] Found at (${coords.x}, ${coords.y}) ${coords.width}x${coords.height}`);
    return coords;
  }

  private elapsed(): number {
    return Date.now() - this.startTime;
  }
}
