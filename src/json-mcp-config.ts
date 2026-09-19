/**
 * Read-merge-write for JSON MCP configuration files.
 *
 * pi, omp and opencode all keep their MCP servers in a JSON file that also
 * holds settings Ceetrix knows nothing about, so every write is a merge and
 * every removal deletes one key and leaves the rest untouched. This is the
 * shape `antigravity.ts` implemented for a single harness; it is generalised
 * here because three harnesses need it and one of them (opencode) has 12 KB of
 * the user's provider and model configuration in the same file.
 *
 * The harnesses differ in two ways this module is parameterised over: the key
 * the server map lives under (`mcpServers` for pi and omp, `mcp` for
 * opencode), and the shape of the entry itself.
 */

import { readFile, writeFile, mkdir, stat, rm } from 'fs/promises';
import { dirname } from 'path';

/**
 * Permissions for a config file Ceetrix creates.
 *
 * These files hold the API key in cleartext, so a file Ceetrix brings into
 * existence is owner-only. An existing file keeps whatever mode it already has
 * — `writeFile` to an existing path truncates in place and does not alter it.
 */
const OWNER_ONLY_MODE = 0o600;

/** Indent used when writing JSON, matching the two-space style already in use. */
const JSON_INDENT = 2;

/** Identifies the server map inside one harness's config file. */
export interface McpContainerSpec {
  /** Absolute path to the config file. */
  filePath: string;
  /** Top-level key holding the map of server name to server config. */
  containerKey: string;
  /** The name Ceetrix registers under. */
  serverName: string;
}

/**
 * A write into one harness's config file.
 *
 * There is deliberately no way to set extra top-level keys. An earlier version
 * allowed it, for a `$schema` reference, and that is what made removal unable
 * to restore a file Ceetrix had created: the key survived, so the file did
 * (task 547.13). Anything Ceetrix writes into someone else's settings has to be
 * something it can also take back.
 */
export interface McpEntrySpec extends McpContainerSpec {
  /** The server entry to store under `serverName`. */
  entry: Record<string, unknown>;
}

/** A parsed config file, or an empty object when there was nothing to parse. */
type JsonConfig = Record<string, unknown>;

/**
 * Read and parse a config file.
 *
 * A missing file is not an error — it means the harness has no MCP config yet.
 * A file that exists but does not parse *is* an error: overwriting it would
 * destroy configuration the user wrote, which is exactly what a merge exists
 * to prevent.
 *
 * @param filePath - Absolute path to the config file
 * @returns The parsed object, or an empty object when the file is absent
 * @throws Error when the file exists and is not valid JSON
 */
async function readConfig(filePath: string): Promise<JsonConfig> {
  let contents: string;

  try {
    contents = await readFile(filePath, 'utf-8');
  } catch {
    return {};
  }

  if (!contents.trim()) {
    return {};
  }

  try {
    return JSON.parse(contents) as JsonConfig;
  } catch (error) {
    throw new Error(
      `${filePath} exists but is not valid JSON, so Ceetrix will not overwrite it. ` +
        `Fix or move the file and run setup again. Parse error: ${(error as Error).message}`
    );
  }
}

/**
 * Write a config file, creating its directory if needed.
 *
 * @param filePath - Absolute path to the config file
 * @param config - The object to serialise
 */
async function writeConfig(filePath: string, config: JsonConfig): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });

  const existed = await fileExists(filePath);
  const body = `${JSON.stringify(config, null, JSON_INDENT)}\n`;

  if (existed) {
    await writeFile(filePath, body, 'utf-8');
    return;
  }

  await writeFile(filePath, body, { encoding: 'utf-8', mode: OWNER_ONLY_MODE });
}

/**
 * Does a path exist?
 *
 * @param filePath - Path to test
 * @returns true when `stat` succeeds
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the server map out of a parsed config.
 *
 * @param config - The parsed config
 * @param containerKey - Top-level key holding the map
 * @returns The map, or an empty object when absent or not an object
 */
function readContainer(config: JsonConfig, containerKey: string): Record<string, unknown> {
  const container = config[containerKey];
  if (container && typeof container === 'object' && !Array.isArray(container)) {
    return container as Record<string, unknown>;
  }
  return {};
}

/**
 * Add or replace the Ceetrix entry, preserving everything else in the file.
 *
 * @param spec - File, container key, server name and entry
 */
export async function writeMcpEntry(spec: McpEntrySpec): Promise<void> {
  const config = await readConfig(spec.filePath);

  config[spec.containerKey] = {
    ...readContainer(config, spec.containerKey),
    [spec.serverName]: spec.entry,
  };

  await writeConfig(spec.filePath, config);
}

/**
 * Is the Ceetrix entry present?
 *
 * A file that will not parse reports false rather than throwing: this runs
 * during detection, where the honest answer to "is it configured" is no.
 *
 * @param spec - File, container key and server name
 * @returns true when the entry exists
 */
export async function hasMcpEntry(spec: McpContainerSpec): Promise<boolean> {
  try {
    const config = await readConfig(spec.filePath);
    return spec.serverName in readContainer(config, spec.containerKey);
  } catch {
    return false;
  }
}

/**
 * Remove the Ceetrix entry, leaving every other server and setting in place.
 *
 * Absent file, absent container or absent entry are all no-ops — removal is
 * idempotent, and re-running it must not create or rewrite anything.
 *
 * @param spec - File, container key and server name
 */
export async function removeMcpEntry(spec: McpContainerSpec): Promise<void> {
  // A missing file needs no explicit guard: readConfig yields {}, the container
  // is then empty, and the absent-entry check below returns without writing.
  const config = await readConfig(spec.filePath);
  const container = readContainer(config, spec.containerKey);

  if (!(spec.serverName in container)) {
    return;
  }

  delete container[spec.serverName];
  config[spec.containerKey] = container;

  // Where nothing of the person's is left, remove the file rather than leaving
  // an empty shell behind. Connecting a harness that had no settings file at
  // all and then disconnecting it must leave the harness as it was found, and
  // a stray file is inert but it is not nothing.
  //
  // Deliberately conservative: this triggers only when the container is empty
  // AND it is the sole top-level key. A file that still holds another server,
  // or any other setting, is written back and kept — Ceetrix cannot tell a
  // file it created from one the person created and then emptied, so the only
  // safe rule is to delete when literally nothing remains.
  if (isEmptyConfig(config, spec.containerKey)) {
    await rm(spec.filePath, { force: true });
    return;
  }

  await writeConfig(spec.filePath, config);
}

/**
 * Does this config still hold anything of the person's?
 *
 * @param config - The parsed config after our entry was removed
 * @param containerKey - Top-level key holding the server map
 * @returns true when the container is empty and is the only top-level key
 */
function isEmptyConfig(config: JsonConfig, containerKey: string): boolean {
  const keys = Object.keys(config);
  if (keys.length !== 1 || keys[0] !== containerKey) {
    return false;
  }
  return Object.keys(readContainer(config, containerKey)).length === 0;
}
