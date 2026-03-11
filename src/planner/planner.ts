import Anthropic from '@anthropic-ai/sdk';
import { ActionPlan, Action } from '../types.js';
import { PLANNER_SYSTEM_PROMPT } from './system-prompt.js';
import { createAnthropicClient } from '../utils/anthropic.js';
import { callClaudeCli } from '../utils/claude-cli.js';

interface PlannerOptions {
  apiKey?: string;
  model: string;
  useCli?: boolean;
}

const ACTION_PLAN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    metadata: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['title', 'description'],
    },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['open_app', 'click', 'double_click', 'type', 'hotkey', 'scroll', 'wait', 'navigate'],
          },
          app: { type: 'string' },
          target: { type: 'string' },
          button: { type: 'string', enum: ['left', 'right'] },
          text: { type: 'string' },
          pressEnter: { type: 'boolean' },
          keys: { type: 'array', items: { type: 'string' } },
          direction: { type: 'string', enum: ['up', 'down'] },
          amount: { type: 'number' },
          durationMs: { type: 'number' },
          url: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['type', 'description'],
      },
    },
  },
  required: ['metadata', 'actions'],
};

const CREATE_DEMO_PLAN_TOOL: Anthropic.Tool = {
  name: 'create_demo_plan',
  description: 'Create a structured demo plan with an ordered list of actions and metadata.',
  input_schema: ACTION_PLAN_JSON_SCHEMA as Anthropic.Tool['input_schema'],
};

export class Planner {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly useCli: boolean;

  constructor(options: PlannerOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.useCli = options.useCli ?? false;
  }

  async createPlan(prompt: string): Promise<ActionPlan> {
    if (this.useCli) {
      return this.createPlanViaCli(prompt);
    }
    return this.createPlanViaApi(prompt);
  }

  private async createPlanViaCli(prompt: string): Promise<ActionPlan> {
    const result = await callClaudeCli({
      prompt,
      systemPrompt: PLANNER_SYSTEM_PROMPT,
      jsonSchema: ACTION_PLAN_JSON_SCHEMA,
      maxTurns: 3,
    });

    if (result.parsed) {
      return result.parsed as ActionPlan;
    }

    // Try to parse the result text as JSON
    const text = result.result;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as ActionPlan;
    }

    throw new Error('Failed to parse action plan from Claude CLI response');
  }

  private async createPlanViaApi(prompt: string): Promise<ActionPlan> {
    const client = createAnthropicClient(this.apiKey);

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: PLANNER_SYSTEM_PROMPT,
      tools: [CREATE_DEMO_PLAN_TOOL],
      tool_choice: { type: 'tool', name: 'create_demo_plan' },
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (!toolUseBlock) {
      throw new Error('Claude did not return a tool_use response. Cannot parse demo plan.');
    }

    const input = toolUseBlock.input as {
      metadata: { title: string; description: string };
      actions: Action[];
    };

    return {
      metadata: input.metadata,
      actions: input.actions,
    };
  }
}
