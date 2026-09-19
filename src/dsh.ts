/**
 * DeepSeek Harness integration — https://github.com/deepseek-ai/deepseek-harness
 *
 * Verified against dsh 0.1.5-rc.2.
 *
 * This harness is unlike the other five in two ways that shape the module.
 *
 * It composes itself from layered adjustment files under named configurations
 * — "profiles" — of which a person may have any number and may create more
 * from a template. Two exist on the reference machine. Ceetrix connects every
 * one it finds, because prd.registration requires an agent that keeps settings
 * in several independent places to be connected in all of them, and because a
 * static default cannot be right for a user-created, unbounded set.
 *
 * Connection support is not built in either: it arrives as a plugin that must
 * be installed into a profile's own dependencies, while the entry referencing
 * it lives in that profile's adjustment file. The two must stay in the same
 * scope. There is a machine-wide adjustment file that applies to every profile,
 * and using it is the smaller edit — but an entry there referencing a plugin
 * installed in only one profile breaks every other profile, so it is not used.
 *
 * dsh describes itself as a developer preview expecting breaking changes. The
 * restart notice says so rather than leaving a person to discover it.
 */

import { join } from 'path';
import { homedir } from 'os';
import { readdir, readFile } from 'fs/promises';
import {
  cachedBinary,
  runHarnessCommand,
  type Harness,
  type HarnessAddSpec,
  type RestartNotice,
  type ThirdPartyInstall,
} from './harness.js';
import { CEETRIX_MCP_SERVER_NAME } from './constants.js';
import { fileExists } from './json-mcp-config.js';
import {
  writeYamlPatchEntry,
  hasYamlPatchEntry,
  removeYamlPatchEntry,
} from './yaml-patch-config.js';

/** Identifier in the AgentType union. */
export const DSH_ID = 'dsh';

/** Name shown in the wizard and the not-found message. */
const DSH_LABEL = 'DeepSeek Harness';

/** Where a user installs it. */
const DSH_HOMEPAGE = 'https://github.com/deepseek-ai/deepseek-harness';

/** Binary name on PATH. */
const DSH_COMMAND = 'dsh';

/**
 * Marker for the identity probe.
 *
 * `dsh --version` prints a bare semver with no product name, so identity comes
 * from its help text, which names the profile mechanism this module depends
 * on. Weaker than a version string: help text carries no compatibility
 * promise.
 */
const DSH_HELP_MARKER = 'profile';

/** Fallback paths. dsh is commonly under a Node version manager, so PATH wins. */
const COMMON_DSH_PATHS = [
  `${process.env.HOME}/.local/bin/dsh`,
  '/opt/homebrew/bin/dsh',
  '/usr/local/bin/dsh',
];

/** Root of dsh's user state, overridable per `dsh --help`. */
const DSH_HOME_DIR = '.dsh';

/** Directory holding the named profiles. */
const DSH_PROFILES_DIR = 'profiles';

/** Per-profile adjustment file Ceetrix extends. */
const DSH_PATCH_FILE = 'cordis.patch.yml';

/** Marks a directory as a profile rather than a shared dependency store. */
const DSH_PROFILE_MANIFEST = 'package.json';

/** The plugin that gives dsh an MCP client. */
export const DSH_MCP_PLUGIN_PACKAGE = '@deepseek-ai/dsh-mcp-client';

/** The core bundle whose version the plugin is pinned to match. */
const DSH_CORE_PACKAGE = '@deepseek-ai/dsh-base';

/** Entry identifier Ceetrix owns in each adjustment file. */
const DSH_ENTRY_ID = 'ceetrix-mcp';

/**
 * Transport name for a remote server.
 *
 * dsh's own name for Streamable HTTP. Not `http`, which is omp's name for the
 * same thing, and not `remote`, which is OpenCode's.
 */
const DSH_TRANSPORT = 'streamable-http';

/**
 * What dsh needs installed, and who publishes it.
 *
 * Unlike pi's adapter, this is published by the same organisation as the
 * harness. It is still a third party relative to Ceetrix and is disclosed on
 * the same terms, but the disclosure names each separately rather than
 * implying they carry the same risk.
 */
const DSH_INSTALLS: readonly ThirdPartyInstall[] = [
  {
    packageName: DSH_MCP_PLUGIN_PACKAGE,
    publisher: 'DeepSeek, the same publisher as the harness',
    reason: 'DeepSeek Harness has no built-in MCP client',
  },
];

const binary = cachedBinary({
  command: DSH_COMMAND,
  fallbackPaths: COMMON_DSH_PATHS,
  probeArgs: '--help',
  marker: DSH_HELP_MARKER,
});

/**
 * Root of dsh's state, honouring the documented override.
 *
 * @returns Absolute path to the dsh home directory
 */
function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), DSH_HOME_DIR);
}

/**
 * Directory holding the named profiles.
 *
 * @returns Absolute path to the profiles directory
 */
function profilesDir(): string {
  return join(dshHome(), DSH_PROFILES_DIR);
}

/**
 * Every profile on this machine.
 *
 * A directory counts as a profile when it carries a manifest. That excludes
 * the shared dependency store which sits alongside the profiles and is not one.
 *
 * @returns Profile names, empty when dsh has no profiles yet
 */
export async function discoverProfiles(): Promise<string[]> {
  let dirents;
  try {
    dirents = await readdir(profilesDir(), { withFileTypes: true });
  } catch {
    return [];
  }

  const names: string[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    if (await fileExists(join(profilesDir(), dirent.name, DSH_PROFILE_MANIFEST))) {
      names.push(dirent.name);
    }
  }
  return names.sort();
}

/**
 * Path to one profile's adjustment file.
 *
 * @param profile - Profile name
 * @returns Absolute path to that profile's cordis.patch.yml
 */
export function getPatchPath(profile: string): string {
  return join(profilesDir(), profile, DSH_PATCH_FILE);
}

/**
 * Version the MCP plugin should be pinned to.
 *
 * Read from the installed core bundle rather than from the launcher's own
 * `--version`, because the launcher and the bundles are versioned separately.
 *
 * This matters: the plugin's default published version is several releases
 * behind the installed program, while a matching one is published under
 * another release tag. Accepting the default would quietly install a
 * mismatched plugin, which is the kind of silent fallback this project
 * forbids — so an unavailable pin is a loud failure instead.
 *
 * @returns The core bundle's version
 * @throws Error when the core bundle cannot be read
 */
export async function pinnedPluginVersion(): Promise<string> {
  const manifest = join(
    profilesDir(),
    'node_modules',
    ...DSH_CORE_PACKAGE.split('/'),
    DSH_PROFILE_MANIFEST
  );

  try {
    const parsed = JSON.parse(await readFile(manifest, 'utf-8')) as { version?: string };
    if (!parsed.version) throw new Error('no version field');
    return parsed.version;
  } catch (error) {
    throw new Error(
      `Could not read ${DSH_CORE_PACKAGE}'s version from ${manifest}, so Ceetrix cannot ` +
        `pin ${DSH_MCP_PLUGIN_PACKAGE} to match the installed harness. Installing the ` +
        `plugin's default version could mismatch it. Underlying error: ${(error as Error).message}`
    );
  }
}

/**
 * Is the MCP plugin already a dependency of this profile?
 *
 * @param profile - Profile name
 * @returns true when the profile's manifest names the plugin
 */
async function isPluginInstalled(profile: string): Promise<boolean> {
  const manifest = join(profilesDir(), profile, DSH_PROFILE_MANIFEST);
  try {
    const parsed = JSON.parse(await readFile(manifest, 'utf-8')) as {
      dependencies?: Record<string, string>;
    };
    return Boolean(parsed.dependencies?.[DSH_MCP_PLUGIN_PACKAGE]);
  } catch {
    return false;
  }
}

/**
 * Install the MCP plugin into one profile, unless it is already there.
 *
 * @param profile - Profile name
 * @throws Error when the install fails
 */
async function ensurePluginInstalled(profile: string): Promise<void> {
  if (await isPluginInstalled(profile)) {
    return;
  }

  const path = await binary.get();
  const version = await pinnedPluginVersion();

  try {
    await runHarnessCommand(
      `"${path}" plugin --profile ${profile} add ${DSH_MCP_PLUGIN_PACKAGE}@${version}`
    );
  } catch (error) {
    throw new Error(
      `Failed to install ${DSH_MCP_PLUGIN_PACKAGE}@${version} into the "${profile}" profile, ` +
        `which DeepSeek Harness needs in order to speak MCP. Run it yourself and retry:\n` +
        `  dsh plugin --profile ${profile} add ${DSH_MCP_PLUGIN_PACKAGE}@${version}\n` +
        `Underlying error: ${(error as Error).message}`
    );
  }
}

/**
 * Build the plugin's configuration block.
 *
 * @param spec - API key and MCP endpoint
 * @returns The configuration for the second entry
 */
function buildConfig(spec: HarnessAddSpec): Record<string, unknown> {
  return {
    serverName: CEETRIX_MCP_SERVER_NAME,
    transport: DSH_TRANSPORT,
    url: spec.url,
    headers: { 'X-API-Key': spec.apiKey },
  };
}

export const harness = {
  id: DSH_ID,
  label: DSH_LABEL,
  homepage: DSH_HOMEPAGE,

  detect: async () => (await binary.get()) !== '',

  isConfigured: async () => {
    const profiles = await discoverProfiles();
    for (const profile of profiles) {
      if (
        await hasYamlPatchEntry({ filePath: getPatchPath(profile), entryId: DSH_ENTRY_ID })
      ) {
        // True when at least one profile carries the entry, so the existing
        // all-configured branch of setup keeps its meaning without every
        // harness having to model several sub-targets.
        return true;
      }
    }
    return false;
  },

  add: async (spec: HarnessAddSpec) => {
    const profiles = await discoverProfiles();

    if (profiles.length === 0) {
      throw new Error(
        `No DeepSeek Harness profiles found under ${profilesDir()}. Start dsh once to ` +
          `create one, then run Ceetrix setup again.`
      );
    }

    for (const profile of profiles) {
      await ensurePluginInstalled(profile);
      await writeYamlPatchEntry({
        filePath: getPatchPath(profile),
        entryId: DSH_ENTRY_ID,
        pluginName: DSH_MCP_PLUGIN_PACKAGE,
        config: buildConfig(spec),
      });
    }
  },

  // The plugin is left installed, as pi's adapter is. Removing a dependency
  // from a profile's manifest is a heavier act than deleting an entry, and the
  // person may have come to rely on it for other servers.
  remove: async () => {
    for (const profile of await discoverProfiles()) {
      await removeYamlPatchEntry({
        filePath: getPatchPath(profile),
        entryId: DSH_ENTRY_ID,
      });
    }
  },

  restartNotice: (): RestartNotice => ({
    title: `Restart ${DSH_LABEL} to activate Ceetrix`,
    lines: [
      'Quit and reopen dsh, then describe a feature you',
      'want to build and ask it to "create a story for it".',
      '',
      'To confirm the server is mounted, run:',
      '  dsh --profile <name> --dump-config',
      '',
      'dsh is a developer preview and its own documentation',
      'expects breaking changes, so this may need redoing.',
    ],
  }),

  diagnose: async () => {
    const path = await binary.get();
    const profiles = await discoverProfiles();
    const lines = [
      `binary: ${path || 'not found'}`,
      `profiles: ${profiles.length > 0 ? profiles.join(', ') : 'none found'}`,
    ];

    for (const profile of profiles) {
      const configured = await hasYamlPatchEntry({
        filePath: getPatchPath(profile),
        entryId: DSH_ENTRY_ID,
      });
      const plugin = await isPluginInstalled(profile);
      lines.push(
        `  ${profile}: entry ${configured ? 'present' : 'absent'}, plugin ${plugin ? 'installed' : 'not installed'}`
      );
    }

    return lines;
  },

  installs: DSH_INSTALLS,

  resetCache: () => binary.reset(),
} satisfies Harness;
