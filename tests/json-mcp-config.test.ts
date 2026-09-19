/**
 * Unit tests for the shared JSON MCP config merge.
 *
 * These run against a real temp directory rather than a mocked fs, because the
 * two properties that matter most — that a merge preserves unrelated keys, and
 * that a newly created file is owner-only — are properties of the filesystem,
 * and a mock would assert only that the code called the functions it calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, stat, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  writeMcpEntry,
  hasMcpEntry,
  removeMcpEntry,
  fileExists,
} from '../src/json-mcp-config.js';

const SERVER_NAME = 'ceetrix';
const TEST_URL = 'https://api.ceetrix.com/mcp';
const TEST_KEY = 'test_api_key';

/** Owner-only, the mode a file holding an API key must be created with. */
const OWNER_ONLY_MODE = 0o600;

let tempDir: string;
let configPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ceetrix-json-mcp-'));
  configPath = join(tempDir, 'config.json');
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/**
 * Read the config file back as a parsed object.
 *
 * @returns The parsed config
 */
async function readBack(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(configPath, 'utf-8')) as Record<string, unknown>;
}

/** The entry shape used across these tests. */
const entry = {
  type: 'http',
  url: TEST_URL,
  headers: { 'X-API-Key': TEST_KEY },
};

describe('writeMcpEntry', () => {
  it('creates the file when absent, with the entry under the container key', async () => {
    await writeMcpEntry({
      filePath: configPath,
      containerKey: 'mcpServers',
      serverName: SERVER_NAME,
      entry,
    });

    const config = await readBack();
    expect(config.mcpServers).toEqual({ [SERVER_NAME]: entry });
  });

  it('creates a new file owner-only, because it holds the API key', async () => {
    await writeMcpEntry({
      filePath: configPath,
      containerKey: 'mcpServers',
      serverName: SERVER_NAME,
      entry,
    });

    const mode = (await stat(configPath)).mode & 0o777;
    expect(mode).toBe(OWNER_ONLY_MODE);
  });

  it('preserves unrelated top-level keys and sibling servers', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        model: 'some/model',
        provider: { openai: { apiKey: 'untouched' } },
        mcp: { pencil: { type: 'local', command: ['pencil-server'] } },
      }),
      'utf-8'
    );

    await writeMcpEntry({
      filePath: configPath,
      containerKey: 'mcp',
      serverName: SERVER_NAME,
      entry,
    });

    const config = await readBack();
    expect(Object.keys(config).sort()).toEqual(['$schema', 'mcp', 'model', 'provider']);
    expect(config.model).toBe('some/model');
    expect(config.provider).toEqual({ openai: { apiKey: 'untouched' } });
    expect(config.mcp).toEqual({
      pencil: { type: 'local', command: ['pencil-server'] },
      [SERVER_NAME]: entry,
    });
  });

  it('leaves the mode of an existing file alone', async () => {
    await writeFile(configPath, JSON.stringify({ mcpServers: {} }), 'utf-8');
    await chmod(configPath, 0o644);

    await writeMcpEntry({
      filePath: configPath,
      containerKey: 'mcpServers',
      serverName: SERVER_NAME,
      entry,
    });

    expect((await stat(configPath)).mode & 0o777).toBe(0o644);
  });

  it('refuses to overwrite a file that exists but does not parse', async () => {
    await writeFile(configPath, '{ this is not json', 'utf-8');

    await expect(
      writeMcpEntry({
        filePath: configPath,
        containerKey: 'mcpServers',
        serverName: SERVER_NAME,
        entry,
      })
    ).rejects.toThrow(/not valid JSON/);

    expect(await readFile(configPath, 'utf-8')).toBe('{ this is not json');
  });

  it('creates missing parent directories', async () => {
    const nested = join(tempDir, 'a', 'b', 'mcp.json');

    await writeMcpEntry({
      filePath: nested,
      containerKey: 'mcpServers',
      serverName: SERVER_NAME,
      entry,
    });

    expect(await fileExists(nested)).toBe(true);
  });
});

describe('hasMcpEntry', () => {
  it('is false when the file is absent', async () => {
    expect(
      await hasMcpEntry({
        filePath: configPath,
        containerKey: 'mcpServers',
        serverName: SERVER_NAME,
      })
    ).toBe(false);
  });

  it('is false when another server is present but ours is not', async () => {
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { other: { url: 'https://other' } } }),
      'utf-8'
    );

    expect(
      await hasMcpEntry({
        filePath: configPath,
        containerKey: 'mcpServers',
        serverName: SERVER_NAME,
      })
    ).toBe(false);
  });

  it('is true after a write', async () => {
    await writeMcpEntry({
      filePath: configPath,
      containerKey: 'mcpServers',
      serverName: SERVER_NAME,
      entry,
    });

    expect(
      await hasMcpEntry({
        filePath: configPath,
        containerKey: 'mcpServers',
        serverName: SERVER_NAME,
      })
    ).toBe(true);
  });

  it('is false rather than throwing when the file does not parse', async () => {
    await writeFile(configPath, 'not json', 'utf-8');

    expect(
      await hasMcpEntry({
        filePath: configPath,
        containerKey: 'mcpServers',
        serverName: SERVER_NAME,
      })
    ).toBe(false);
  });
});

describe('removeMcpEntry', () => {
  it('deletes only our entry', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        model: 'keep-me',
        mcpServers: {
          other: { url: 'https://other' },
          [SERVER_NAME]: entry,
        },
      }),
      'utf-8'
    );

    await removeMcpEntry({
      filePath: configPath,
      containerKey: 'mcpServers',
      serverName: SERVER_NAME,
    });

    const config = await readBack();
    expect(config.mcpServers).toEqual({ other: { url: 'https://other' } });
    expect(config.model).toBe('keep-me');
  });

  it('deletes a file it emptied, leaving the harness as it was found', async () => {
    // Connecting a harness that had no settings file and then disconnecting it
    // must leave nothing behind. Found by running the real pi harness, where
    // removal left {"mcpServers": {}} where no file had existed (task 547.13).
    await writeMcpEntry({
      filePath: configPath,
      containerKey: 'mcpServers',
      serverName: SERVER_NAME,
      entry,
    });
    expect(await fileExists(configPath)).toBe(true);

    await removeMcpEntry({
      filePath: configPath,
      containerKey: 'mcpServers',
      serverName: SERVER_NAME,
    });

    expect(await fileExists(configPath)).toBe(false);
  });

  it('keeps the file when another server survives', async () => {
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { other: { url: 'https://other' }, [SERVER_NAME]: entry } }),
      'utf-8'
    );

    await removeMcpEntry({
      filePath: configPath,
      containerKey: 'mcpServers',
      serverName: SERVER_NAME,
    });

    expect(await fileExists(configPath)).toBe(true);
    expect((await readBack()).mcpServers).toEqual({ other: { url: 'https://other' } });
  });

  it('keeps the file when any other top-level setting survives', async () => {
    // Ceetrix cannot tell a file it created from one the person created and
    // then emptied, so anything else present means the file stays.
    await writeFile(
      configPath,
      JSON.stringify({ model: 'theirs', mcpServers: { [SERVER_NAME]: entry } }),
      'utf-8'
    );

    await removeMcpEntry({
      filePath: configPath,
      containerKey: 'mcpServers',
      serverName: SERVER_NAME,
    });

    expect(await fileExists(configPath)).toBe(true);
    expect((await readBack()).model).toBe('theirs');
  });

  it('is a no-op on a missing file and does not create one', async () => {
    await removeMcpEntry({
      filePath: configPath,
      containerKey: 'mcpServers',
      serverName: SERVER_NAME,
    });

    expect(await fileExists(configPath)).toBe(false);
  });

  it('round-trips: add then remove restores the original bytes', async () => {
    const original = `${JSON.stringify({ mcp: { pencil: { type: 'local' } } }, null, 2)}\n`;
    await writeFile(configPath, original, 'utf-8');

    await writeMcpEntry({
      filePath: configPath,
      containerKey: 'mcp',
      serverName: SERVER_NAME,
      entry,
    });
    await removeMcpEntry({
      filePath: configPath,
      containerKey: 'mcp',
      serverName: SERVER_NAME,
    });

    expect(await readFile(configPath, 'utf-8')).toBe(original);
  });
});
