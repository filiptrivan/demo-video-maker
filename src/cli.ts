#!/usr/bin/env node

import { Command } from 'commander';
import type { DemoConfig } from './types.js';
import { run } from './pipeline.js';
import { setDebug, error as logError } from './utils/logger.js';

const program = new Command();

program
  .name('demo-video-maker')
  .description('AI-powered CLI tool that creates professional demo videos from text prompts')
  .version('1.0.0')
  .argument('<prompt>', 'Description of the demo to record')
  .option('-W, --width <number>', 'Output video width', '1920')
  .option('-H, --height <number>', 'Output video height', '1080')
  .option('--fps <number>', 'Frames per second', '30')
  .option('-o, --output <path>', 'Output file path', './output.mp4')
  .option('-m, --model <model>', 'Claude model to use', 'claude-sonnet-4-6')
  .option('--zoom-factor <number>', 'Maximum auto-zoom factor', '1.5')
  .option('--debug', 'Enable debug logging', false)
  .option('--use-cli', 'Use claude CLI instead of API (works with OAuth/subscription)', false)
  .action(async (prompt: string, options: Record<string, string | boolean>) => {
    const config: DemoConfig = {
      prompt,
      width: parseInt(options.width as string, 10),
      height: parseInt(options.height as string, 10),
      fps: parseInt(options.fps as string, 10),
      outputPath: options.output as string,
      model: options.model as string,
      zoomFactor: parseFloat(options.zoomFactor as string),
      debug: options.debug as boolean,
      useCli: options.useCli as boolean,
    };

    if (config.debug) {
      setDebug(true);
    }

    console.log('=== Demo Video Maker ===\n');

    try {
      const outputPath = await run(config);
      console.log(`\n=== Done! Video saved to: ${outputPath} ===`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n=== Failed: ${message} ===`);
      logError(message);
      process.exit(1);
    }
  });

program.parse();
