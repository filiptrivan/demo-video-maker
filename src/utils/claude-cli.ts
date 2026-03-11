import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { debug } from './logger.js';

export interface ClaudeCliOptions {
  prompt: string;
  systemPrompt?: string;
  jsonSchema?: object;
  maxTurns?: number;
  tools?: string;
  allowedTools?: string[];
  files?: string[];
}

export interface ClaudeCliResult {
  result: string;
  parsed?: unknown;
}

/**
 * Calls the `claude` CLI in print mode (-p) and returns the result.
 * This uses the user's existing Claude Code auth (OAuth token / subscription).
 */
export async function callClaudeCli(options: ClaudeCliOptions): Promise<ClaudeCliResult> {
  const args: string[] = ['-p'];
  const tempFiles: string[] = [];

  try {
    // Output format and session settings
    args.push('--output-format', 'json');
    args.push('--no-session-persistence');

    // JSON schema for structured output
    if (options.jsonSchema) {
      args.push('--json-schema', JSON.stringify(options.jsonSchema));
    }

    // System prompt — write to temp file to avoid arg length/escaping issues
    if (options.systemPrompt) {
      const promptPath = join(tmpdir(), `demo-sysprompt-${randomBytes(4).toString('hex')}.txt`);
      await writeFile(promptPath, options.systemPrompt, 'utf-8');
      tempFiles.push(promptPath);
      args.push('--system-prompt-file', promptPath);
    }

    // Max turns
    if (options.maxTurns) {
      args.push('--max-turns', String(options.maxTurns));
    }

    // Restrict tools
    if (options.tools !== undefined && options.tools !== '') {
      args.push('--tools', options.tools);
    }

    // Allow tools to run without permission prompts (needed for non-interactive subprocess)
    if (options.allowedTools?.length) {
      for (const tool of options.allowedTools) {
        args.push('--allowedTools', tool);
      }
    }

    // Build prompt
    let fullPrompt = options.prompt;
    if (options.files?.length) {
      const fileRefs = options.files.map(f => `File: ${f}`).join('\n');
      fullPrompt = `${fileRefs}\n\n${options.prompt}`;
    }

    // Write prompt to temp file and pipe via stdin to avoid arg escaping issues
    const promptPath = join(tmpdir(), `demo-prompt-${randomBytes(4).toString('hex')}.txt`);
    await writeFile(promptPath, fullPrompt, 'utf-8');
    tempFiles.push(promptPath);

    debug('Calling claude CLI with', args.length, 'args');

    return await runClaude(args, options, promptPath);
  } finally {
    for (const f of tempFiles) {
      try { await unlink(f); } catch { /* ignore */ }
    }
  }
}

function runClaude(args: string[], options: ClaudeCliOptions, promptFile: string): Promise<ClaudeCliResult> {
  return new Promise((resolve, reject) => {
    // Remove CLAUDECODE env var to allow running claude as a subprocess
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const proc = spawn('claude', args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    // Pipe the prompt via stdin
    import('node:fs/promises').then(fsp =>
      fsp.readFile(promptFile, 'utf-8').then(content => {
        proc.stdin!.write(content);
        proc.stdin!.end();
      })
    );

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    proc.stdout.on('data', (data: Buffer) => chunks.push(data));
    proc.stderr.on('data', (data: Buffer) => errChunks.push(data));

    proc.on('error', (err) => {
      reject(new Error(`Failed to start claude CLI: ${err.message}`));
    });

    proc.on('close', (code) => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      const stderr = Buffer.concat(errChunks).toString('utf-8').trim();

      if (stderr) debug('claude CLI stderr:', stderr);
      debug('claude CLI exit code:', code, '| stdout length:', raw.length);

      if (!raw) {
        reject(new Error(`claude CLI returned no output (exit code ${code}): ${stderr}`));
        return;
      }

      try {
        const envelope = JSON.parse(raw);

        // With --json-schema, structured output is in envelope.structured_output
        if (options.jsonSchema && envelope.structured_output) {
          resolve({
            result: JSON.stringify(envelope.structured_output),
            parsed: envelope.structured_output,
          });
          return;
        }

        const resultText = envelope.result ?? envelope.content ?? raw;

        let parsed: unknown = undefined;
        if (options.jsonSchema) {
          try {
            parsed = typeof resultText === 'string' ? JSON.parse(resultText) : resultText;
          } catch {
            const str = typeof resultText === 'string' ? resultText : JSON.stringify(resultText);
            const jsonMatch = str.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[0]);
            }
          }
        }

        resolve({
          result: typeof resultText === 'string' ? resultText : JSON.stringify(resultText),
          parsed,
        });
      } catch {
        resolve({ result: raw });
      }
    });
  });
}
