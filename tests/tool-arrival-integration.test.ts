/**
 * Do Ceetrix's tools actually reach the model, and can the model use them?
 *
 * Every other suite in this story stops at registration: the settings file is
 * correct, the server is listed, the plugin is mounted. None of that proves a
 * model can call a Ceetrix tool, which is the only thing a user cares about.
 *
 * Two layers here. The read layer asks each agent to run Ceetrix's search and
 * assert a real result comes back. The write layer asks it to create a comment
 * and then reads that comment back over a separate MCP connection — because an
 * agent reporting success is not evidence. In the manual runs that preceded
 * this file, all four reported success before anything had been confirmed.
 *
 * Everything targets STAGING. These cases write, and a suite that posts to the
 * operator's real project on every run is not acceptable. There is no fallback
 * to production: without a staging credential the cases skip.
 *
 * An earlier version of this work claimed the gap could not be closed for pi
 * and omp, because neither has an `mcp` subcommand that lists servers. That was
 * wrong, and this file is the retraction: the absence of a listing subcommand
 * is not the absence of a way to check. All four have a non-interactive print
 * mode, which is enough to make the model call a tool and read the reply.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, cp, mkdir, copyFile, writeFile, readFile } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import which from 'which';
import { fileExists } from '../src/json-mcp-config.js';

/**
 * A model call plus an MCP round trip.
 *
 * Observed runs land around five to ten seconds per harness, so five minutes is
 * headroom rather than an expectation. It is deliberately not larger: a hung
 * agent should fail the case, not hold the suite for a quarter of an hour.
 */
const MODEL_TIMEOUT_MS = 300000;

/** How long the direct read-back may take. No model involved, so short. */
const MCP_TIMEOUT_MS = 30000;

/** Provider and model used for the prompt. Cheap, fast, and tool-capable. */
const TEST_PROVIDER = 'cerebras';
const TEST_MODEL = 'gpt-oss-120b';

/** Environment variable holding the model credential. */
const MODEL_KEY_ENV = 'CEREBRAS_API_KEY';

/** The repository the agent is asked to work against. */
const TEST_REMOTE = 'git@github.com:boxabirds/claude-backlog.git';

/**
 * Staging, never production.
 *
 * There is deliberately NO fallback to production: when the staging credential
 * is absent the cases skip with a printed reason, because a test that silently
 * writes somewhere it was not pointed is worse than one that does not run.
 */
const STAGING_MCP_URL = 'https://staging-api.ceetrix.com/mcp';

/**
 * Where the installer puts the credential for a custom API URL.
 *
 * Derived the way getAutoConfigPath does: the host with dots and colons
 * replaced by dashes. Reading it rather than hardcoding a key keeps secrets out
 * of the repository.
 */
const STAGING_CONFIG = '.claude-ceetrix-staging-api-ceetrix-com.json';

/** The staging story these cases comment on. */
const STAGING_STORY_ID = '296';

/** The search query. Its result is large and stable enough to assert on. */
const TEST_QUERY = 'harness';

/**
 * The read prompt, per agent.
 *
 * pi reaches Ceetrix through the adapter's proxy tool rather than directly
 * named tools, so it is told to name the server and the tool. Instructing the
 * others that way would test a path they do not have. This is the only place
 * the agents genuinely need different words.
 *
 * @param agent - Which harness
 * @returns The prompt
 */
function readPrompt(agent: string): string {
  const task =
    `the ceetrix search tool with query '${TEST_QUERY}' and remote_url ` +
    `'${TEST_REMOTE}'. Report only the number of matches.`;
  return agent === 'pi'
    ? `Use the mcp tool with server 'ceetrix' and tool 'search' to call ${task}`
    : `Call ${task}`;
}

/** Pulls the count out of Ceetrix's "Found N matches for ..." reply. */
const FOUND_COUNT = /Found\s+(\d+)\s+match/i;

let stagingKey: string | null = null;
let sandbox: string;

/**
 * Run an agent non-interactively and return everything it printed.
 *
 * Uses spawn with stdin IGNORED rather than execFile. That is not a style
 * preference: execFile leaves stdin as an open pipe and these agents wait on
 * it, so every case hung until its timeout although the identical command
 * completes in seconds from a shell. The symptom was a suite that looked slow
 * rather than broken, which is the worst way for one to fail.
 *
 * Runs in an empty sandbox directory rather than the repository. These agents
 * read instruction files from their working directory, so running them here
 * pulled this project's CLAUDE.md into every prompt — which showed up as a
 * model reciting this repository's agent-disclosure text instead of answering,
 * and contributed to one agent intermittently not calling the tool at all. A
 * test should not inherit the repository it happens to be launched from.
 *
 * @param binary - Absolute path to the agent
 * @param args - Arguments
 * @param env - Environment overrides
 * @param cwd - Working directory for the agent
 * @returns Combined stdout and stderr
 */
function runAgent(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
 * Read the STAGING credential the installer wrote to its side config.
 *
 * Never reads the production credential. When this returns null the cases skip
 * rather than reaching for ~/.claude.json instead.
 *
 * @returns The staging key, or null when staging has never been set up here
 */
async function readStagingKey(): Promise<string | null> {
  const config = join(homedir(), STAGING_CONFIG);
  if (!(await fileExists(config))) return null;
  try {
    const parsed = JSON.parse(await readFile(config, 'utf-8'));
    return parsed?.mcpServers?.ceetrix?.headers?.['X-API-Key'] ?? null;
  } catch {
    return null;
  }
}

/**
 * A comment body unique to this run and this agent.
 *
 * Comments accumulate on the staging story, so each carries its origin and
 * timestamp: an accumulation is then explicable rather than mysterious, and the
 * read-back finds this run's comment rather than one from an earlier run.
 *
 * @param agent - Which harness wrote it
 * @returns The comment body
 */
function writeMarker(agent: string): string {
  return `tool-arrival write check from ${agent} at ${new Date().toISOString()}`;
}

/**
 * Parse a streamable-HTTP reply, which may arrive as JSON or as SSE frames.
 *
 * @param body - Raw response text
 * @returns The first JSON-RPC result carrying tool content, or null
 */
function parseMcpReply(body: string): string | null {
  for (const line of body.split('\n')) {
    const payload = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
    if (!payload.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(payload);
      const content = parsed?.result?.content;
      if (Array.isArray(content)) {
        return content.map((c: { text?: string }) => c.text ?? '').join('');
      }
    } catch {
      // Not a complete JSON frame; keep scanning.
    }
  }
  return null;
}

/**
 * Call one Ceetrix tool directly over MCP, independent of any agent.
 *
 * This is what makes the write layer evidence rather than hearsay: the reply
 * comes from the server over a connection the agent had nothing to do with.
 *
 * @param tool - Tool name
 * @param args - Tool arguments
 * @returns The tool's text output
 * @throws Error when the handshake or the call fails
 */
async function callCeetrixDirectly(tool: string, args: Record<string, unknown>): Promise<string> {
  const headers = {
    'X-API-Key': stagingKey!,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };

  const init = await fetch(STAGING_MCP_URL, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'tool-arrival-verify', version: '0' },
      },
    }),
  });
  const session = init.headers.get('mcp-session-id');
  if (!session) throw new Error('staging did not return an MCP session id');

  const withSession = { ...headers, 'mcp-session-id': session };
  await fetch(STAGING_MCP_URL, {
    method: 'POST',
    headers: withSession,
    signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });

  const call = await fetch(STAGING_MCP_URL, {
    method: 'POST',
    headers: withSession,
    signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });

  const text = parseMcpReply(await call.text());
  if (text === null) throw new Error(`staging returned no content for ${tool}`);
  return text;
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
  if (!stagingKey) {
    console.log(
      `Skipping ${name}: no staging credential at ~/${STAGING_CONFIG}. ` +
        `Create one by running setup with CEETRIX_API_URL=https://staging-api.ceetrix.com`
    );
    return false;
  }
  return true;
}

/** Everything a case needs to drive one agent in the sandbox. */
interface AgentRunner {
  /** Environment that points the agent at the sandbox. */
  env: NodeJS.ProcessEnv;
  /** Turn a prompt into that agent's non-interactive argument list. */
  args: (prompt: string) => string[];
  /** Empty directory to run in, so no project instruction files are read. */
  cwd: string;
}

/**
 * Configure one agent inside the sandbox, pointed at staging.
 *
 * Each agent is isolated by a different variable, which is the only real
 * difference between them: the registry means `add` is the same call for all.
 *
 * @param agent - Which harness
 * @returns How to run it
 */
async function configureAgent(agent: 'opencode' | 'pi' | 'omp' | 'dsh'): Promise<AgentRunner> {
  const spec = { apiKey: stagingKey!, url: STAGING_MCP_URL };
  // An empty directory with no instruction files and no git repository.
  const workdir = join(sandbox, 'work');
  await mkdir(workdir, { recursive: true });

  if (agent === 'opencode') {
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
    await (await import('../src/opencode.js')).harness.add(spec);
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;

    return {
      cwd: workdir,
      env: { ...process.env, XDG_CONFIG_HOME: configRoot },
      args: (prompt) => [
        'run',
        '--log-level',
        'ERROR',
        '--model',
        `${TEST_PROVIDER}/${TEST_MODEL}`,
        prompt,
      ],
    };
  }

  if (agent === 'dsh') {
    // Copy the real profile tree: it carries the operator's own routing and
    // their own written notes, and is small because dependencies are linked.
    const dshHome = join(sandbox, 'dsh');
    await cp(join(homedir(), '.dsh'), dshHome, { recursive: true });
    const previous = process.env.DSH_HOME;
    process.env.DSH_HOME = dshHome;
    await (await import('../src/dsh.js')).harness.add(spec);
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;

    // The machine's configured model server may be unreachable, so an overlay
    // points dsh at one that is, mirroring the operator's own home patch.
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

    return {
      cwd: workdir,
      env: { ...process.env, DSH_HOME: dshHome },
      args: (prompt) => ['--profile', 'headless', '--patch', overlay, prompt],
    };
  }

  // pi and omp are both isolated by HOME.
  const home = join(sandbox, 'home');
  await mkdir(home, { recursive: true });
  const previous = process.env.HOME;
  process.env.HOME = home;
  await (await import(agent === 'pi' ? '../src/pi.js' : '../src/omp.js')).harness.add(spec);
  process.env.HOME = previous;

  return {
    cwd: workdir,
    env: { ...process.env, HOME: home },
    args: (prompt) =>
      agent === 'pi'
        ? ['-p', '--provider', TEST_PROVIDER, '--model', TEST_MODEL, prompt]
        : ['-p', '--model', TEST_MODEL, prompt],
  };
}

/**
 * The number of matches staging really holds for the test query.
 *
 * Fetched over a connection no agent touched, so the read assertion compares
 * the agent's answer against the server's rather than against a pattern. A
 * loose "contains some digits" check passes on a fabricated number and on
 * stray digits elsewhere in the output; this cannot.
 *
 * @returns The current count as a string
 * @throws Error when staging's reply cannot be parsed
 */
async function trueMatchCount(): Promise<string> {
  const reply = await callCeetrixDirectly('search', {
    query: TEST_QUERY,
    remote_url: TEST_REMOTE,
  });
  const found = reply.match(FOUND_COUNT);
  if (!found) throw new Error(`staging search reply had no match count: ${reply.slice(0, 120)}`);
  return found[1];
}

beforeAll(async () => {
  stagingKey = await readStagingKey();
});

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'ceetrix-tool-arrival-'));
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

/** The agents under test, with the binary each needs. */
const AGENTS = [
  { key: 'opencode', binary: 'opencode', label: 'OpenCode' },
  { key: 'pi', binary: 'pi', label: 'pi, through the third-party adapter' },
  { key: 'omp', binary: 'omp', label: 'omp' },
  { key: 'dsh', binary: 'dsh', label: 'DeepSeek Harness, tools named mcp__ceetrix__*' },
] as const;

describe('the model can READ through a Ceetrix tool', () => {
  it.each(AGENTS)('$label', async ({ key, binary, label }) => {
    const path = await find(binary);
    if (!canRun(path, label)) return;
    if (key === 'dsh' && !(await fileExists(join(homedir(), '.dsh', 'profiles')))) {
      console.log('Skipping DeepSeek Harness: no profile tree to copy');
      return;
    }

    const expected = await trueMatchCount();
    const runner = await configureAgent(key);
    const output = await runAgent(path!, runner.args(readPrompt(key)), runner.env, runner.cwd);

    expect(output.toLowerCase(), `${label} reported an error instead of a result`).not.toMatch(
      /no project context|failed to connect|tool not found|unable to connect/
    );
    // The count comes from the server, so a model that did not call the tool
    // cannot produce it.
    expect(output, `${label} did not report staging's actual match count`).toContain(expected);
  }, MODEL_TIMEOUT_MS);
});

describe('the model can WRITE through a Ceetrix tool', () => {
  it.each(AGENTS)('$label', async ({ key, binary, label }) => {
    const path = await find(binary);
    if (!canRun(path, label)) return;
    if (key === 'dsh' && !(await fileExists(join(homedir(), '.dsh', 'profiles')))) {
      console.log('Skipping DeepSeek Harness: no profile tree to copy');
      return;
    }

    const marker = writeMarker(key);
    const runner = await configureAgent(key);
    await runAgent(
      path!,
      runner.args(
        `Use the ceetrix comment tool, action create, story_id ${STAGING_STORY_ID}, ` +
          `remote_url '${TEST_REMOTE}', body exactly: ${marker}`
      ),
      runner.env,
      runner.cwd
    );

    // Read back over a connection the agent had nothing to do with. What the
    // agent said about its own success is not evidence: in the manual runs
    // that preceded this file, all four claimed success before anything had
    // been confirmed.
    const comments = await callCeetrixDirectly('comment', {
      action: 'list',
      story_id: STAGING_STORY_ID,
      remote_url: TEST_REMOTE,
    });
    expect(comments, `${label} did not create a comment on staging`).toContain(marker);
  }, MODEL_TIMEOUT_MS);
});
