/**
 * Unit tests for the DeepSeek Harness adjustment-file editor.
 *
 * Covers TC-35 from the story 547 test strategy, plus the surrounding cases.
 *
 * The central fixture is the verbatim content of a real adjustment file from a
 * working machine, comments and all. That is deliberate: the failure this
 * module exists to prevent is silently deleting prose the person wrote, and a
 * minimal invented fixture cannot demonstrate that it does not happen.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse } from 'yaml';
import {
  writeYamlPatchEntry,
  hasYamlPatchEntry,
  removeYamlPatchEntry,
} from '../src/yaml-patch-config.js';
import { fileExists } from '../src/json-mcp-config.js';

const ENTRY_ID = 'ceetrix-mcp';
const PLUGIN = '@deepseek-ai/dsh-mcp-client';
const TEST_URL = 'https://api.ceetrix.com/mcp';
const TEST_KEY = 'test_api_key';

/** Owner-only, since these entries carry the credential. */
const OWNER_ONLY_MODE = 0o600;

/**
 * A real profile adjustment file, copied verbatim from a working machine.
 *
 * Every comment here is the operator's own prose. The point of the round-trip
 * assertion is that all of it survives.
 */
const REAL_PROFILE_PATCH = `# Web profile patch layer (applied after every bundle layer, before the
# home-level ~/.dsh/cordis.patch.yml which holds the gruntus model routes).
#
# Web search via Exa instead of DeepSeek's cloud search API. The provider
# reads EXA_API_KEY from the launch environment (shell, ./.env, ~/.dsh/.env).
# The \`web-search-exa\` plugin is installed in this profile's package.json.

- insert:
    - id: web-search-exa
      name: '@deepseek-ai/dsh-web-search-exa'

- id: web
  config:
    searchProvider: exa
    fetchProvider: http

# DeepSeek search needs DEEPSEEK_API_KEY, which is not configured; unmount it.
- id: web-search-deepseek
  disabled: true
`;

/** The other real shape observed: comments above an empty list. */
const COMMENTS_AND_EMPTY_LIST = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`;

let tempDir: string;
let patchPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ceetrix-yaml-'));
  patchPath = join(tempDir, 'cordis.patch.yml');
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/** The configuration block written under our entry. */
const config = {
  serverName: 'ceetrix',
  transport: 'streamable-http',
  url: TEST_URL,
  headers: { 'X-API-Key': TEST_KEY },
};

/**
 * Add our entry to the file at patchPath.
 */
async function addEntry(): Promise<void> {
  await writeYamlPatchEntry({
    filePath: patchPath,
    entryId: ENTRY_ID,
    pluginName: PLUGIN,
    config,
  });
}

describe('writeYamlPatchEntry', () => {
  it('creates the file when absent, mounting and configuring the plugin', async () => {
    await addEntry();

    const parsed = parse(await readFile(patchPath, 'utf-8')) as any[];
    const mount = parsed.find((e) => e.insert);
    const configure = parsed.find((e) => e.config);

    expect(mount.insert[0]).toEqual({ id: ENTRY_ID, name: PLUGIN });
    expect(configure.id).toBe(ENTRY_ID);
    expect(configure.config.serverName).toBe('ceetrix');
    expect(configure.config.transport).toBe('streamable-http');
    expect(configure.config.headers['X-API-Key']).toBe(TEST_KEY);
  });

  it('creates a new file owner-only, because the entry holds the credential', async () => {
    await addEntry();
    expect((await stat(patchPath)).mode & 0o777).toBe(OWNER_ONLY_MODE);
  });

  it('uses two entries, not a config nested inside the insert item', async () => {
    // Whether nesting is legal is unverified; the two-entry form is the shape
    // observed working on a real machine, so it is the shape used.
    await addEntry();

    const parsed = parse(await readFile(patchPath, 'utf-8')) as any[];
    const mount = parsed.find((e) => e.insert);
    expect(mount.insert[0]).not.toHaveProperty('config');
  });

  it('TC-35: keeps every comment the person wrote', async () => {
    await writeFile(patchPath, REAL_PROFILE_PATCH, 'utf-8');

    await addEntry();

    const after = await readFile(patchPath, 'utf-8');
    expect(after).toContain('# Web profile patch layer (applied after every bundle layer, before the');
    expect(after).toContain("# reads EXA_API_KEY from the launch environment");
    expect(after).toContain('# DeepSeek search needs DEEPSEEK_API_KEY, which is not configured; unmount it.');
  });

  it('keeps the entries the person already had', async () => {
    await writeFile(patchPath, REAL_PROFILE_PATCH, 'utf-8');

    await addEntry();

    const parsed = parse(await readFile(patchPath, 'utf-8')) as any[];
    const ids = parsed.flatMap((e) => (e.insert ? e.insert.map((i: any) => i.id) : [e.id]));
    expect(ids).toContain('web-search-exa');
    expect(ids).toContain('web');
    expect(ids).toContain('web-search-deepseek');
  });

  it('extends a file that is comments above an empty list', async () => {
    await writeFile(patchPath, COMMENTS_AND_EMPTY_LIST, 'utf-8');

    await addEntry();

    const after = await readFile(patchPath, 'utf-8');
    expect(after).toContain('# dsh profile root');
    expect(after).toContain(ENTRY_ID);
  });

  it('replaces our entry on a second run rather than mounting it twice', async () => {
    await addEntry();
    await writeYamlPatchEntry({
      filePath: patchPath,
      entryId: ENTRY_ID,
      pluginName: PLUGIN,
      config: { ...config, headers: { 'X-API-Key': 'rotated_key' } },
    });

    const parsed = parse(await readFile(patchPath, 'utf-8')) as any[];
    const mounts = parsed.filter((e) => e.insert);
    const configures = parsed.filter((e) => e.config);
    expect(mounts).toHaveLength(1);
    expect(configures).toHaveLength(1);
    expect(configures[0].config.headers['X-API-Key']).toBe('rotated_key');
  });

  it('refuses a file that will not parse, and leaves it alone', async () => {
    const broken = '- insert:\n  - id: [unclosed\n';
    await writeFile(patchPath, broken, 'utf-8');

    await expect(addEntry()).rejects.toThrow(/could not be parsed/);
    expect(await readFile(patchPath, 'utf-8')).toBe(broken);
  });

  it('refuses a file that is not a list of entries', async () => {
    await writeFile(patchPath, 'someKey: someValue\n', 'utf-8');
    await expect(addEntry()).rejects.toThrow(/not a list of adjustment entries/);
  });
});

describe('hasYamlPatchEntry', () => {
  it('is false when the file is absent', async () => {
    expect(await hasYamlPatchEntry({ filePath: patchPath, entryId: ENTRY_ID })).toBe(false);
  });

  it('is false for a real file that has other entries but not ours', async () => {
    await writeFile(patchPath, REAL_PROFILE_PATCH, 'utf-8');
    expect(await hasYamlPatchEntry({ filePath: patchPath, entryId: ENTRY_ID })).toBe(false);
  });

  it('is true after a write', async () => {
    await addEntry();
    expect(await hasYamlPatchEntry({ filePath: patchPath, entryId: ENTRY_ID })).toBe(true);
  });

  it('is false rather than throwing when the file will not parse', async () => {
    await writeFile(patchPath, '- id: [unclosed\n', 'utf-8');
    expect(await hasYamlPatchEntry({ filePath: patchPath, entryId: ENTRY_ID })).toBe(false);
  });
});

describe('removeYamlPatchEntry', () => {
  it('TC-35: restores a real file to its exact prior bytes', async () => {
    await writeFile(patchPath, REAL_PROFILE_PATCH, 'utf-8');

    await addEntry();
    await removeYamlPatchEntry({ filePath: patchPath, entryId: ENTRY_ID });

    expect(await readFile(patchPath, 'utf-8')).toBe(REAL_PROFILE_PATCH);
  });

  it('restores a comments-above-empty-list file exactly', async () => {
    await writeFile(patchPath, COMMENTS_AND_EMPTY_LIST, 'utf-8');

    await addEntry();
    await removeYamlPatchEntry({ filePath: patchPath, entryId: ENTRY_ID });

    expect(await readFile(patchPath, 'utf-8')).toBe(COMMENTS_AND_EMPTY_LIST);
  });

  it('leaves no file behind where none existed before', async () => {
    await addEntry();
    await removeYamlPatchEntry({ filePath: patchPath, entryId: ENTRY_ID });

    expect(await fileExists(patchPath)).toBe(false);
  });

  it('is a no-op when our entry was never added', async () => {
    await writeFile(patchPath, REAL_PROFILE_PATCH, 'utf-8');
    await removeYamlPatchEntry({ filePath: patchPath, entryId: ENTRY_ID });
    expect(await readFile(patchPath, 'utf-8')).toBe(REAL_PROFILE_PATCH);
  });

  it('is a no-op on a missing file and creates nothing', async () => {
    await removeYamlPatchEntry({ filePath: patchPath, entryId: ENTRY_ID });
    expect(await fileExists(patchPath)).toBe(false);
  });
});
