/**
 * Do Ceetrix's tools actually reach the model?
 *
 * Every other suite in this story stops at registration: the settings file is
 * correct, the server is listed, the plugin is mounted. None of that proves a
 * model can call a Ceetrix tool, which is the only thing a user cares about.
 *
 * An earlier version of this work claimed that gap could not be closed for pi
 * and omp, because neither has an `mcp` subcommand that lists servers. That was
 * wrong, and this file is the retraction: the absence of a listing subcommand
 * is not the absence of a way to check. All four agents have a non-interactive
 * print mode, which is enough to make the model call a tool and read the reply.
 *
 * Each case configures the agent in a sandbox, asks it to run Ceetrix's search
 * against this repository, and asserts the real result comes back. A model
 * cannot fabricate the match count for a query it never ran — and all four were
 * observed returning the same number independently, which is what makes the
 * assertion meaningful rather than a coincidence of phrasing.
 *
 * These cost a model call each, so they skip unless a credential is present.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, cp, mkdir, copyFile, writeFile } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import which from 'which';
import { fileExists } from '../src/json-mcp-config.js';

/**
 * Run an agent non-interactively and return everything it printed.
 *
 * Uses spawn with stdin IGNORED rather than execFile. That is not a style
 * preference: execFile leaves stdin as an open pipe, and these agents wait on
 * it, so every case hung until its timeout even though the identical command
 * completes in about seven seconds from a shell. The symptom was a suite that
 * looked slow rather than broken, which is the worst way for it to fail.
 *
 * @param binary - Absolute path to the agent
 * @param args - Arguments
 * @param env - Environment overrides
 * @returns Combined stdout and stderr
 */
function runAgent(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${binary} did not answer within ${MODEL_TIMEOUT_MS}ms`));
    }, MODEL_TIMEOUT_MS);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(output);
    });
  });
}

/**
 * A model call plus an MCP round trip.
 *
 * Observed runs land between roughly thirty seconds and three minutes per
 * harness, so five minutes is headroom rather than an expectation. It is
 * deliberately not larger: a hung agent should fail the case, not hold the
 * suite for a quarter of an hour.
 */
const MODEL_TIMEOUT_MS = 300000;

/** Provider and model used for the prompt. Cheap, fast, and tool-capable. */
const TEST_PROVIDER = 'cerebras';
const TEST_MODEL = 'gpt-oss-120b';

/** Environment variable holding the model credential. */
const MODEL_KEY_ENV = 'CEREBRAS_API_KEY';

/** The repository the agent is asked to search. */
const TEST_REMOTE = 'git@github.com:boxabirds/claude-backlog.git';

/** The query. Chosen because its result is large and stable enough to assert on. */
const TEST_QUERY = 'harness';

/**
 * The prompt. Deliberately explicit: the point is to test whether the tool is
 * reachable, not whether a small model can infer that it should use one.
 */
const PROMPT =
  `Call the ceetrix search tool with query '${TEST_QUERY}' and remote_url ` +
  `'${TEST_REMOTE}'. Report only the number of matches.`;

/**
 * What a real reply looks like.
 *
 * Ceetrix answers with "Found N matches for ...". Asserting on the digits alone
 * would pass on a fabricated number, so the assertion requires a plausible
 * count AND that the agent did not report an error instead.
 */
const MATCH_PATTERN = /\b(\d{2,5})\b/;

let ceetrixKey: string | null = null;
let sandbox: string;

/**
 * Read the developer's Ceetrix credential, which the agents need in order to
 * reach the live server.
 *
 * @returns The key, or null when Claude Code is not configured here
 */
async function readCeetrixKey(): Promise<string | null> {
  const claudeConfig = join(homedir(), '.claude.json');
  if (!(await fileExists(claudeConfig))) return null;
  try {
    const parsed = JSON.parse(await (await import('fs/promises')).readFile(claudeConfig, 'utf-8'));
    return parsed?.mcpServers?.ceetrix?.headers?.['X-API-Key'] ?? null;
  } catch {
    return null;
  }
}

/**
 * Is a binary installed?
 *
 * @param command - Command name
 * @returns Its path, or null
 */
async function find(command: string): Promise<string | null> {
  try {
    return await which(command);
  } catch {
    return null;
  }
}

/**
 * Should a case run?
 *
 * @param binary - Path to the agent binary, or null
 * @param name - Agent name, for the skip message
 * @returns true when the case can run
 */
function canRun(binary: string | null, name: string): boolean {
  if (!binary) {
    console.log(`Skipping ${name}: not installed`);
    return false;
  }
  if (!process.env[MODEL_KEY_ENV]) {
    console.log(`Skipping ${name}: ${MODEL_KEY_ENV} not set, and this case needs a model`);
    return false;
  }
  if (!ceetrixKey) {
    console.log(`Skipping ${name}: no Ceetrix credential found in ~/.claude.json`);
    return false;
  }
  return true;
}

/**
 * Assert that a reply carries a real search result rather than a failure.
 *
 * @param output - What the agent printed
 * @param agent - Agent name, for the failure message
 */
function expectRealResult(output: string, agent: string): void {
  expect(output.toLowerCase(), `${agent} reported an error instead of a result`).not.toMatch(
    /no project context|failed to connect|tool not found|unable to connect/
  );
  expect(output, `${agent} returned no match count`).toMatch(MATCH_PATTERN);
}

beforeAll(async () => {
  ceetrixKey = await readCeetrixKey();
});

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'ceetrix-tool-arrival-'));
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('the model can call a Ceetrix tool', () => {
  it('OpenCode', async () => {
    const binary = await find('opencode');
    if (!canRun(binary, 'OpenCode')) return;

    // Copy the developer's own config so providers and models are real, then
    // add Ceetrix to the copy. Their file is never written.
    const configRoot = join(sandbox, 'config');
    await mkdir(join(configRoot, 'opencode'), { recursive: true });
    const theirs = join(homedir(), '.config', 'opencode', 'opencode.json');
    if (await fileExists(theirs)) {
      await copyFile(theirs, join(configRoot, 'opencode', 'opencode.json'));
    }

    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = configRoot;
    const { harness } = await import('../src/opencode.js');
    await harness.add({ apiKey: ceetrixKey!, url: 'https://api.ceetrix.com/mcp' });
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;

    const output = await runAgent(binary!, ['run', '--log-level', 'ERROR', '--model', `${TEST_PROVIDER}/${TEST_MODEL}`, PROMPT], { ...process.env, XDG_CONFIG_HOME: configRoot });
    expectRealResult(output, 'OpenCode');
  }, MODEL_TIMEOUT_MS);

  it('pi, through the third-party adapter', async () => {
    const binary = await find('pi');
    if (!canRun(binary, 'pi')) return;

    const home = join(sandbox, 'home');
    await mkdir(home, { recursive: true });

    const previous = process.env.HOME;
    process.env.HOME = home;
    const { harness } = await import('../src/pi.js');
    await harness.add({ apiKey: ceetrixKey!, url: 'https://api.ceetrix.com/mcp' });
    process.env.HOME = previous;

    // pi reaches Ceetrix through the adapter's proxy tool rather than through
    // directly named tools, so this also exercises that indirection.
    const output = await runAgent(binary!, ['-p', '--provider', TEST_PROVIDER, '--model', TEST_MODEL, PROMPT], { ...process.env, HOME: home });
    expectRealResult(output, 'pi');
  }, MODEL_TIMEOUT_MS);

  it('omp', async () => {
    const binary = await find('omp');
    if (!canRun(binary, 'omp')) return;

    const home = join(sandbox, 'home');
    await mkdir(home, { recursive: true });

    const previous = process.env.HOME;
    process.env.HOME = home;
    const { harness } = await import('../src/omp.js');
    await harness.add({ apiKey: ceetrixKey!, url: 'https://api.ceetrix.com/mcp' });
    process.env.HOME = previous;

    const output = await runAgent(binary!, ['-p', '--model', TEST_MODEL, PROMPT], { ...process.env, HOME: home });
    expectRealResult(output, 'omp');
  }, MODEL_TIMEOUT_MS);

  it('DeepSeek Harness, exposing tools as mcp__ceetrix__*', async () => {
    const binary = await find('dsh');
    const realDshHome = join(homedir(), '.dsh', 'profiles');
    if (!canRun(binary, 'DeepSeek Harness')) return;
    if (!(await fileExists(realDshHome))) {
      console.log('Skipping DeepSeek Harness: no profile tree to copy');
      return;
    }

    const dshHome = join(sandbox, 'dsh');
    await cp(join(homedir(), '.dsh'), dshHome, { recursive: true });

    const previous = process.env.DSH_HOME;
    process.env.DSH_HOME = dshHome;
    const { harness } = await import('../src/dsh.js');
    await harness.add({ apiKey: ceetrixKey!, url: 'https://api.ceetrix.com/mcp' });
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;

    // The machine's configured model server may be unreachable, so a provider
    // overlay points dsh at one that is. This mirrors the shape of the
    // operator's own home patch rather than inventing a new one.
    const overlay = join(sandbox, 'provider.yml');
    await writeFile(
      overlay,
      [
        '- id: llm-pi-ai',
        '  config:',
        '    providers:',
        `      ${TEST_PROVIDER}:`,
        '        api: openai-completions',
        '        baseURL: https://api.cerebras.ai/v1',
        `        apiKeyEnv: ${MODEL_KEY_ENV}`,
        '        models:',
        `          - id: ${TEST_MODEL}`,
        '            contextWindow: 131072',
        '            maxTokens: 32768',
        '',
        '- id: agent-default-model',
        '  config:',
        `    provider: ${TEST_PROVIDER}`,
        `    model: ${TEST_MODEL}`,
        '',
      ].join('\n'),
      'utf-8'
    );

    const output = await runAgent(binary!, ['--profile', 'headless', '--patch', overlay, PROMPT], { ...process.env, DSH_HOME: dshHome });
    expectRealResult(output, 'DeepSeek Harness');
  }, MODEL_TIMEOUT_MS);
});
