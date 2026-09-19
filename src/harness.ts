/**
 * The harness contract.
 *
 * A "harness" is a coding agent that speaks MCP. Ceetrix supports one by being
 * registrable in that agent's MCP configuration — detect it, write the entry,
 * report whether the entry is there, remove it again. Nothing else. Ceetrix
 * requires no hooks and no instruction files.
 *
 * Every harness module exports one `Harness` object. `harnesses.ts` collects
 * them into the single array that the wizard, the config checks, the setup
 * loop and `--debug` all iterate. Adding a harness is a new module plus one
 * array entry, not an edit to a switch statement in four files.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import which from 'which';

const execAsync = promisify(exec);

/**
 * Short timeout for a `--version` / `--help` probe.
 *
 * Detection runs every harness in parallel at startup, and an old or wedged
 * binary can hang rather than answer, so the probe is bounded.
 */
export const PROBE_TIMEOUT_MS = 3000;

/** Timeout for a harness's own CLI doing real work (installing, writing config). */
export const HARNESS_COMMAND_TIMEOUT_MS = 10000;

/**
 * Everything a harness needs in order to register Ceetrix.
 *
 * The server name is deliberately not here. It is the same in every harness
 * (`CEETRIX_MCP_SERVER_NAME`), and `isConfigured()` and `remove()` take no
 * arguments, so a per-call name would have to be recovered from somewhere else
 * on those two paths — which is a defect waiting to happen rather than
 * flexibility anyone needs.
 */
export interface HarnessAddSpec {
  /** The API key, sent as the X-API-Key header on every MCP request. */
  apiKey: string;
  /** The Ceetrix MCP endpoint. */
  url: string;
}

/**
 * Software published by someone other than Ceetrix that a harness needs
 * installed before it can reach Ceetrix at all.
 *
 * Declared on the harness rather than written out in the permission prompt, so
 * the two cannot drift into an installer that fetches something it never
 * named. A test asserts every declaration here appears in the disclosure.
 */
export interface ThirdPartyInstall {
  /** The package, exactly as it is published. */
  packageName: string;
  /** Who publishes it. Not Ceetrix, which is the whole point of disclosing it. */
  publisher: string;
  /** Why the harness cannot reach Ceetrix without it. */
  reason: string;
}

/** The box printed after a harness is configured. */
export interface RestartNotice {
  /**
   * Heading line. `flow.test.ts` asserts on these substrings, so the wording
   * "Restart <label>" is load-bearing.
   */
  title: string;
  /** Body lines, printed in order. */
  lines: string[];
}

/** One supported coding agent. */
export interface Harness {
  /** Stable identifier. Also the `AgentType` union member. */
  readonly id: string;
  /** Human-facing name, used by the wizard and the not-found error. */
  readonly label: string;
  /** Where a user goes to install it, for the not-found error. */
  readonly homepage: string;

  /** Is this harness installed and usable? */
  detect(): Promise<boolean>;

  /**
   * Is Ceetrix registered in it?
   *
   * Reports on the configuration Ceetrix itself wrote. A harness that inherits
   * MCP servers from another tool's config (omp does) reports false here even
   * though its tools work, because `remove()` must have a true inverse and can
   * only undo what `add()` did.
   */
  isConfigured(): Promise<boolean>;

  /** Register Ceetrix. Throws with an actionable message on failure. */
  add(spec: HarnessAddSpec): Promise<void>;

  /** Unregister Ceetrix, preserving every other entry in the file. */
  remove(): Promise<void>;

  /** What to tell the user once `add` has succeeded. */
  restartNotice(): RestartNotice;

  /** Lines for `ceetrix --debug`. */
  diagnose(): Promise<string[]>;

  /**
   * Third-party software this harness installs during setup.
   *
   * Omitted by harnesses that install nothing, which is most of them.
   */
  readonly installs?: readonly ThirdPartyInstall[];

  /** Drop any memoised binary path. Tests only. */
  resetCache(): void;
}

/**
 * Raised when a harness declines to change something rather than failing.
 *
 * The distinction matters to the person reading the summary. "Failed" means
 * Ceetrix tried and could not. "Skipped" means Ceetrix deliberately did not
 * touch something — an annotated settings file it would have to rewrite,
 * destroying the person's comments — and there is something they can do about
 * it by hand. Collapsing the two would present a considered refusal as a bug.
 */
export class HarnessSkipped extends Error {
  /** What the person should do instead, printed under the summary. */
  readonly instructions: string;

  /**
   * @param message - Why the harness was skipped
   * @param instructions - What to do by hand
   */
  constructor(message: string, instructions: string) {
    super(message);
    this.name = 'HarnessSkipped';
    this.instructions = instructions;
  }
}

/** How to find and verify a harness binary. */
export interface BinaryProbeSpec {
  /** Command name to look up on PATH. */
  command: string;
  /**
   * Absolute paths to try when PATH lookup fails.
   *
   * Only useful for harnesses installed to a predictable location. pi and dsh
   * are installed under nvm here, whose paths are version-specific, so for
   * those the PATH lookup is what actually works and this list is a courtesy.
   */
  fallbackPaths?: string[];
  /** Arguments for the identifying probe. */
  probeArgs: string;
  /**
   * Substring the probe output must contain.
   *
   * Claude Code and omp print their own name, so this is a real identity check
   * for them. pi, opencode and dsh print a bare semver from `--version`, so
   * their probe reads `--help` instead, which is a weaker contract than a
   * version string and is documented as such at each call site.
   */
  marker: string;
}

/**
 * Find a harness binary and verify it is the program we think it is.
 *
 * `which` is used rather than assuming PATH is populated, because npx runs in
 * a non-login shell where user-configured directories are often missing.
 *
 * @param spec - Command, fallbacks and identity marker
 * @returns Absolute path to the verified binary, or null
 */
export async function findBinary(spec: BinaryProbeSpec): Promise<string | null> {
  const candidates: string[] = [];

  try {
    candidates.push(await which(spec.command));
  } catch {
    // Not on PATH; fall through to the explicit list.
  }

  candidates.push(...(spec.fallbackPaths ?? []));

  for (const path of candidates) {
    if (await matchesMarker(path, spec)) {
      return path;
    }
  }

  return null;
}

/**
 * Run the identifying probe against one candidate path.
 *
 * @param path - Candidate executable
 * @param spec - Probe arguments and expected marker
 * @returns true if the probe output contains the marker
 */
async function matchesMarker(path: string, spec: BinaryProbeSpec): Promise<boolean> {
  try {
    const { stdout, stderr } = await execAsync(`"${path}" ${spec.probeArgs}`, {
      timeout: PROBE_TIMEOUT_MS,
    });
    return `${stdout}${stderr}`.includes(spec.marker);
  } catch {
    return false;
  }
}

/**
 * Memoise a binary lookup.
 *
 * Detection is called from the wizard, the config check and `--debug` within
 * one run; the probe spawns a process each time, so the result is cached.
 *
 * @param spec - What to look for
 * @returns A getter for the path (empty string when absent) and a cache reset
 */
export function cachedBinary(spec: BinaryProbeSpec): {
  get: () => Promise<string>;
  reset: () => void;
} {
  let cached: string | null = null;

  return {
    get: async () => {
      if (cached === null) {
        cached = (await findBinary(spec)) ?? '';
      }
      return cached;
    },
    reset: () => {
      cached = null;
    },
  };
}

/**
 * Run a command belonging to a harness.
 *
 * @param command - Full command line
 * @returns Combined stdout
 * @throws Whatever the child process failed with
 */
export async function runHarnessCommand(command: string): Promise<string> {
  const { stdout } = await execAsync(command, {
    timeout: HARNESS_COMMAND_TIMEOUT_MS,
  });
  return stdout;
}
