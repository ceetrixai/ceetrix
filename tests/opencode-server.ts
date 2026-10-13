/**
 * A private OpenCode server for the integration suites.
 *
 * OpenCode 2 runs `opencode mcp list` and `opencode run` through one shared
 * background service per user (`opencode serve --service`), started with that
 * user's own configuration. Pointing XDG_CONFIG_HOME at a temp directory does
 * not reach it, so a test that relies on that variable is answered from the
 * developer's real config: it can see their servers instead of the one under
 * test, and a write meant for staging can reach whatever Ceetrix server their
 * config names. Verified against opencode 2.0.20 on 2026-10-13.
 *
 * So each test starts its own server with `opencode serve` (never `--service`,
 * which takes over the user's background service), on a free port, behind a
 * password, reading only the temp configuration, and talks to it with
 * `--server`.
 *
 * A server loads its MCP servers lazily, on the first request for a
 * directory: the first `mcp.list` answers with nothing. Callers therefore wait
 * for a named server to appear rather than reading the first answer.
 */

import { spawn, execFile, type ChildProcess } from 'child_process';
import { createServer } from 'net';
import { randomBytes } from 'crypto';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const LOOPBACK = '127.0.0.1';

/** Bytes of randomness in the per-server password. */
const PASSWORD_BYTES = 16;

/** How long a server may take to accept connections. */
const START_TIMEOUT_MS = 60000;

/** Status of an MCP server opencode has listed but not finished connecting. */
const PENDING_STATUS = 'pending';

/** How long a server may take to load and connect a named MCP server. */
const MCP_LOAD_TIMEOUT_MS = 60000;

/** Pause between polls while waiting. */
const POLL_INTERVAL_MS = 1000;

/** How long a stopped server may take to exit before it is killed. */
const STOP_TIMEOUT_MS = 10000;

/** Timeout for one `opencode api` request. */
const API_TIMEOUT_MS = 60000;

/**
 * An unreachable remote server, added to a configuration so that its
 * appearance in `mcp.list` shows the server has loaded the file. Without it,
 * "ceetrix is not listed" would also be true before anything had loaded.
 */
export const CONTROL_SERVER_NAME = 'ceetrix-test-control';
export const CONTROL_SERVER_ENTRY = { type: 'remote', url: 'http://127.0.0.1:9/mcp', enabled: true };

/** One entry of `mcp.list`. */
export interface McpServerStatus {
  name: string;
  status: { status: string; error?: string };
}

/** A running private server. */
export interface OpencodeServer {
  /** Base URL to pass to `--server`. */
  url: string;
  /** Environment for a client of this server: carries its password. */
  clientEnv: NodeJS.ProcessEnv;
  /** Stop the server and wait for it to exit. */
  stop: () => Promise<void>;
}

/** What a private server is started with. */
export interface OpencodeServerSpec {
  /** Path to the opencode binary. */
  binary: string;
  /** Directory holding `opencode/opencode.json`, used as XDG_CONFIG_HOME. */
  configRoot: string;
  /** Working directory for the server and its clients. */
  cwd: string;
}

/**
 * A port nothing is listening on.
 *
 * @returns Port number
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, LOOPBACK, () => {
      const address = probe.address();
      probe.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('could not allocate a port'));
      });
    });
  });
}

/**
 * Wait for a child process to exit.
 *
 * @param child - The process
 * @param timeoutMs - How long to wait
 * @returns true when it exited in time
 */
function exited(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/**
 * Start a private server reading only the given configuration.
 *
 * @param spec - Binary, configuration root and working directory
 * @returns The running server
 * @throws Error when it does not accept connections in time
 */
export async function startOpencodeServer(spec: OpencodeServerSpec): Promise<OpencodeServer> {
  const port = await freePort();
  const password = randomBytes(PASSWORD_BYTES).toString('hex');
  const url = `http://${LOOPBACK}:${port}`;
  let log = '';
  const child = spawn(spec.binary, ['serve', '--hostname', LOOPBACK, '--port', String(port)], {
    cwd: spec.cwd,
    env: { ...process.env, XDG_CONFIG_HOME: spec.configRoot, OPENCODE_SERVER_PASSWORD: password },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => (log += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (log += chunk.toString()));

  const stop = async () => {
    child.kill('SIGTERM');
    if (!(await exited(child, STOP_TIMEOUT_MS))) {
      child.kill('SIGKILL');
      await exited(child, STOP_TIMEOUT_MS);
    }
  };

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`opencode serve exited with ${child.exitCode} before accepting connections:\n${log}`);
    }
    try {
      await fetch(url);
      return { url, clientEnv: { ...process.env, OPENCODE_PASSWORD: password }, stop };
    } catch {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  await stop();
  throw new Error(`opencode serve did not accept connections within ${START_TIMEOUT_MS}ms:\n${log}`);
}

/**
 * The MCP servers a private server reports for its working directory.
 *
 * @param binary - Path to the opencode binary
 * @param server - The private server
 * @param cwd - Working directory, which selects the location reported
 * @returns The servers listed, possibly none while still loading
 */
export async function listMcpServers(
  binary: string,
  server: OpencodeServer,
  cwd: string
): Promise<McpServerStatus[]> {
  const { stdout } = await execFileAsync(binary, ['api', '--server', server.url, 'mcp.list'], {
    cwd,
    env: server.clientEnv,
    timeout: API_TIMEOUT_MS,
  });
  return JSON.parse(stdout).data as McpServerStatus[];
}

/**
 * Wait until the server lists the named MCP server with a settled status (not
 * pending), and return the full list.
 *
 * @param binary - Path to the opencode binary
 * @param server - The private server
 * @param cwd - Working directory
 * @param name - Server name to wait for
 * @returns The full list once the named server is in it
 * @throws Error when it does not appear in time, with the last list seen
 */
export async function waitForMcpServer(
  binary: string,
  server: OpencodeServer,
  cwd: string,
  name: string
): Promise<McpServerStatus[]> {
  const deadline = Date.now() + MCP_LOAD_TIMEOUT_MS;
  let last: McpServerStatus[] = [];
  while (Date.now() < deadline) {
    last = await listMcpServers(binary, server, cwd);
    if (last.some((s) => s.name === name && s.status.status !== PENDING_STATUS)) return last;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`opencode did not settle "${name}" within ${MCP_LOAD_TIMEOUT_MS}ms; last list: ${JSON.stringify(last)}`);
}
