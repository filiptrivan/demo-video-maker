import Anthropic from '@anthropic-ai/sdk';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ScreenCoordinates } from '../types.js';
import { sleep } from '../utils/sleep.js';
import { createAnthropicClient } from '../utils/anthropic.js';
import { callClaudeCli } from '../utils/claude-cli.js';
import { debug } from '../utils/logger.js';

const COORDS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    x: { type: 'number', description: 'X coordinate of the top-left corner in pixels' },
    y: { type: 'number', description: 'Y coordinate of the top-left corner in pixels' },
    width: { type: 'number', description: 'Width of the bounding box in pixels' },
    height: { type: 'number', description: 'Height of the bounding box in pixels' },
  },
  required: ['x', 'y', 'width', 'height'],
};

export class VisionLocator {
  private apiKey?: string;
  private model: string;
  private useCli: boolean;

  constructor({ apiKey, model, useCli }: { apiKey?: string; model: string; useCli?: boolean }) {
    this.apiKey = apiKey;
    this.model = model;
    this.useCli = useCli ?? false;
  }

  async locateElement(
    screenshotBase64: string,
    targetDescription: string,
  ): Promise<ScreenCoordinates> {
    if (this.useCli) {
      return this.locateViaCli(screenshotBase64, targetDescription);
    }
    return this.locateViaApi(screenshotBase64, targetDescription);
  }

  private async locateViaCli(
    screenshotBase64: string,
    targetDescription: string,
  ): Promise<ScreenCoordinates> {
    // Save screenshot to temp file so claude CLI can read it
    const tmpPath = join(tmpdir(), `demo-screenshot-${randomBytes(4).toString('hex')}.png`);
    await writeFile(tmpPath, Buffer.from(screenshotBase64, 'base64'));

    try {
      const result = await callClaudeCli({
        prompt: `Look at this screenshot image: ${tmpPath}

You are looking at a screenshot of a desktop. Find the UI element described as: "${targetDescription}". Return its bounding box coordinates (x, y of top-left corner, width, height in pixels). Only return the JSON coordinates, nothing else.`,
        jsonSchema: COORDS_JSON_SCHEMA,
        maxTurns: 5,
        tools: 'Read',
        allowedTools: ['Read'],
      });

      debug('Vision CLI result:', result.result);

      if (result.parsed) {
        const coords = result.parsed as ScreenCoordinates;
        if (typeof coords.x === 'number' && typeof coords.y === 'number') {
          return coords;
        }
      }

      // Try to extract from text
      const text = result.result;
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const coords = JSON.parse(jsonMatch[0]) as ScreenCoordinates;
        if (typeof coords.x === 'number' && typeof coords.y === 'number') {
          return coords;
        }
      }

      throw new Error(`Could not parse coordinates from Claude CLI response for: "${targetDescription}"`);
    } finally {
      try { await unlink(tmpPath); } catch { /* ignore */ }
    }
  }

  private async locateViaApi(
    screenshotBase64: string,
    targetDescription: string,
  ): Promise<ScreenCoordinates> {
    const client = createAnthropicClient(this.apiKey);

    const locateTool: Anthropic.Tool = {
      name: 'locate_element',
      description: 'Return the bounding box of the UI element found in the screenshot.',
      input_schema: COORDS_JSON_SCHEMA as Anthropic.Tool['input_schema'],
    };

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 1024,
      tools: [locateTool],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: screenshotBase64,
              },
            },
            {
              type: 'text',
              text: `You are looking at a screenshot of a desktop. Find the UI element described as: ${targetDescription}. Return its bounding box coordinates (x, y of top-left corner, width, height in pixels).`,
            },
          ],
        },
      ],
    });

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ContentBlock & { type: 'tool_use' } =>
        block.type === 'tool_use' && block.name === 'locate_element',
    );

    if (!toolUseBlock) {
      throw new Error(
        `Vision could not locate element: "${targetDescription}". No tool_use response received.`,
      );
    }

    const input = toolUseBlock.input as ScreenCoordinates;
    return { x: input.x, y: input.y, width: input.width, height: input.height };
  }

  async locateWithRetry(
    screenshotBase64: string,
    targetDescription: string,
    maxRetries: number = 3,
    delayMs: number = 1000,
  ): Promise<ScreenCoordinates> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.locateElement(screenshotBase64, targetDescription);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries - 1) {
          await sleep(delayMs);
        }
      }
    }

    throw new Error(
      `Failed to locate element "${targetDescription}" after ${maxRetries} attempts: ${lastError?.message}`,
    );
  }
}
