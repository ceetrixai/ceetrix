/**
 * Editing DeepSeek Harness's layered adjustment files without destroying them.
 *
 * That harness composes itself from an ordered list of adjustment entries, in a
 * format that lets a person write notes among them — and they do. The file on
 * the reference machine carries several paragraphs of the operator's own prose
 * explaining why they routed the tool at a self-hosted server instead of the
 * cloud API, and why one search provider replaced another.
 *
 * Reading that into plain data and writing it back deletes every one of those
 * notes, silently. That is precisely the loss prd.preservation forbids, so the
 * editing goes through a document representation that preserves comments and
 * ordering rather than through a parse-and-dump cycle. This is why `yaml` is a
 * runtime dependency, the same kind of decision as `smol-toml` for Codex.
 *
 * Two entries are written, mirroring the shape the operator's own file already
 * uses: one that mounts the plugin, and a separate one that configures it by
 * identifier. Nesting the configuration inside the mounting entry is not known
 * to be valid, so the shape observed working is the shape used.
 */

import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { dirname } from 'path';
import { parseDocument, Document, YAMLSeq, YAMLMap, isMap, isSeq } from 'yaml';
import { fileExists } from './json-mcp-config.js';

/**
 * Permissions for an adjustment file Ceetrix creates.
 *
 * These entries carry the credential, so a file brought into existence here is
 * owner-only. A file that already exists keeps the permissions it has.
 */
const OWNER_ONLY_MODE = 0o600;

/** Key naming a plugin instance inside an entry. */
const ID_KEY = 'id';

/** Key naming the plugin package inside an insert item. */
const NAME_KEY = 'name';

/** Key holding an entry's configuration block. */
const CONFIG_KEY = 'config';

/** Key whose value is the list of plugin instances to mount. */
const INSERT_KEY = 'insert';

/** One plugin instance Ceetrix owns in an adjustment file. */
export interface YamlPatchSpec {
  /** Absolute path to the adjustment file. */
  filePath: string;
  /** The entry identifier Ceetrix owns. Both written entries carry it. */
  entryId: string;
  /** The plugin package the mounting entry names. */
  pluginName: string;
  /** The configuration block for the second entry. */
  config: Record<string, unknown>;
}

/** Locating fields shared by the presence check and removal. */
export type YamlPatchTarget = Pick<YamlPatchSpec, 'filePath' | 'entryId'>;

/**
 * Read an adjustment file as a document that remembers comments.
 *
 * A missing file yields an empty list, which is the same thing the harness's
 * own profile root contains before anything is layered onto it.
 *
 * @param filePath - Absolute path to the adjustment file
 * @returns The parsed document, with its top level guaranteed to be a sequence
 * @throws Error when the file exists and cannot be parsed
 */
async function readPatchDocument(filePath: string): Promise<Document> {
  let contents: string;

  try {
    contents = await readFile(filePath, 'utf-8');
  } catch {
    const empty = new Document(new YAMLSeq());
    return empty;
  }

  const doc = parseDocument(contents);

  if (doc.errors.length > 0) {
    throw new Error(
      `${filePath} exists but could not be parsed, so Ceetrix will not overwrite it. ` +
        `Fix or move the file and run setup again. Parse error: ${doc.errors[0].message}`
    );
  }

  // A file that is only comments parses to a null document. Treat that as an
  // empty list rather than discarding the comments: assigning contents keeps
  // the leading comment block attached to the document.
  if (!isSeq(doc.contents)) {
    if (doc.contents === null || doc.contents === undefined) {
      doc.contents = new YAMLSeq() as never;
      return doc;
    }
    throw new Error(
      `${filePath} is not a list of adjustment entries, which is the only shape ` +
        `Ceetrix knows how to extend. Ceetrix has not modified it.`
    );
  }

  return doc;
}

/**
 * Write a document back, preserving the comments it carries.
 *
 * @param filePath - Absolute path to the adjustment file
 * @param doc - The document to serialise
 */
async function writePatchDocument(filePath: string, doc: Document): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });

  const existed = await fileExists(filePath);
  const body = doc.toString();

  if (existed) {
    await writeFile(filePath, body, 'utf-8');
    return;
  }

  await writeFile(filePath, body, { encoding: 'utf-8', mode: OWNER_ONLY_MODE });
}

/**
 * The top-level sequence of a patch document.
 *
 * @param doc - The parsed document
 * @returns Its entry list
 */
function entries(doc: Document): YAMLSeq {
  return doc.contents as unknown as YAMLSeq;
}

/**
 * Read a plain string field off a mapping node.
 *
 * @param node - The node to inspect
 * @param key - Field name
 * @returns The value when it is a string, otherwise null
 */
function stringField(node: unknown, key: string): string | null {
  if (!isMap(node)) return null;
  const value = node.get(key);
  return typeof value === 'string' ? value : null;
}

/**
 * Does an entry mount our plugin, or configure it?
 *
 * @param node - A top-level entry
 * @param entryId - The identifier Ceetrix owns
 * @returns true when the entry belongs to Ceetrix
 */
function isOurEntry(node: unknown, entryId: string): boolean {
  if (stringField(node, ID_KEY) === entryId) {
    return true;
  }

  // An insert entry holds a list of instances; it is ours when every instance
  // it holds is ours. An insert that also mounts something else is left alone
  // and only our instance is taken out of it.
  if (isMap(node)) {
    const inserted = node.get(INSERT_KEY);
    if (isSeq(inserted)) {
      return inserted.items.length > 0 && inserted.items.every((item) => stringField(item, ID_KEY) === entryId);
    }
  }

  return false;
}

/**
 * Is our plugin instance present in this file?
 *
 * A file that will not parse reports false rather than raising: this runs
 * during detection, where the honest answer is that nothing is configured.
 *
 * @param target - File and entry identifier
 * @returns true when our entry is present
 */
export async function hasYamlPatchEntry(target: YamlPatchTarget): Promise<boolean> {
  try {
    const doc = await readPatchDocument(target.filePath);
    return entries(doc).items.some((item) => isOurEntry(item, target.entryId));
  } catch {
    return false;
  }
}

/**
 * Add or replace our plugin instance, leaving every other entry and every
 * comment in the file untouched.
 *
 * @param spec - File, entry identifier, plugin package and configuration
 */
export async function writeYamlPatchEntry(spec: YamlPatchSpec): Promise<void> {
  const doc = await readPatchDocument(spec.filePath);

  // Replacing rather than appending, so re-running setup updates the
  // credential instead of mounting the plugin a second time.
  removeOurEntries(doc, spec.entryId);

  const mount = new YAMLMap();
  const instance = new YAMLMap();
  instance.set(ID_KEY, spec.entryId);
  instance.set(NAME_KEY, spec.pluginName);
  const instances = new YAMLSeq();
  instances.add(instance);
  mount.set(INSERT_KEY, instances);

  const configure = new YAMLMap();
  configure.set(ID_KEY, spec.entryId);
  configure.set(CONFIG_KEY, doc.createNode(spec.config));

  entries(doc).add(mount);
  entries(doc).add(configure);

  await writePatchDocument(spec.filePath, doc);
}

/**
 * Drop every entry belonging to us from a document.
 *
 * @param doc - The parsed document
 * @param entryId - The identifier Ceetrix owns
 * @returns How many entries were removed
 */
function removeOurEntries(doc: Document, entryId: string): number {
  const list = entries(doc);
  const before = list.items.length;
  list.items = list.items.filter((item) => !isOurEntry(item, entryId));
  return before - list.items.length;
}

/**
 * Remove our plugin instance, leaving the rest of the file as it was.
 *
 * Where nothing at all remains, the file is deleted rather than left as an
 * empty list, for the same reason the JSON removal deletes an emptied file:
 * a harness that had no adjustment file before must not have one after.
 *
 * @param target - File and entry identifier
 */
export async function removeYamlPatchEntry(target: YamlPatchTarget): Promise<void> {
  if (!(await fileExists(target.filePath))) {
    return;
  }

  const doc = await readPatchDocument(target.filePath);

  if (removeOurEntries(doc, target.entryId) === 0) {
    return;
  }

  const body = doc.toString();
  const nothingLeft = entries(doc).items.length === 0 && !body.includes('#');

  if (nothingLeft) {
    await rm(target.filePath, { force: true });
    return;
  }

  await writePatchDocument(target.filePath, doc);
}
