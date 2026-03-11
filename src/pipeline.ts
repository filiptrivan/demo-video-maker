import { screen } from '@nut-tree-fork/nut-js';
import type { DemoConfig, RecordingSession } from './types.js';
import { Planner } from './planner/planner.js';
import { Executor } from './executor/executor.js';
import { Renderer } from './renderer/renderer.js';
import { checkFFmpegInstalled } from './utils/platform.js';
import { info, error as logError } from './utils/logger.js';

export async function run(config: DemoConfig): Promise<string> {
  // Pre-flight checks
  if (!checkFFmpegInstalled()) {
    throw new Error('FFmpeg is not installed or not on PATH. Please install FFmpeg first.');
  }

  // Get actual screen dimensions
  const screenWidth = await screen.width();
  const screenHeight = await screen.height();
  info(`Screen resolution: ${screenWidth}x${screenHeight}`);

  // Step 1: Plan
  info('Planning demo actions...');
  const planner = new Planner({ model: config.model, useCli: config.useCli });
  const plan = await planner.createPlan(config.prompt);
  info(`Plan created: "${plan.metadata.title}" with ${plan.actions.length} actions`);

  if (config.debug) {
    info('Action plan:');
    for (const action of plan.actions) {
      info(`  - [${action.type}] ${action.description}`);
    }
  }

  // Step 2: Execute
  info('Executing demo...');
  const executor = new Executor({
    model: config.model,
    fps: config.fps,
    screenWidth,
    screenHeight,
    zoomFactor: config.zoomFactor,
    debug: config.debug,
    useCli: config.useCli,
  });

  const session: RecordingSession = await executor.execute(plan);
  info(`Recording complete: ${(session.durationMs / 1000).toFixed(1)}s`);

  // Step 3: Render
  info('Rendering final video...');
  const renderer = new Renderer({
    outputPath: config.outputPath,
    screenWidth,
    screenHeight,
    outputWidth: config.width,
    outputHeight: config.height,
  });

  const outputPath = await renderer.render(session);
  info(`Done! Video saved to: ${outputPath}`);

  return outputPath;
}
