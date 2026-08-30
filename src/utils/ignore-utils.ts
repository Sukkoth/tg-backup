import { join } from 'node:path';

/**
 * Parses comma-separated directory names into a normalized Set.
 *
 * @param rawInput Raw CLI input string (e.g. "node_modules,.git")
 * @returns Set of directory names to ignore
 */
export function parseIgnoreDirs(rawInput?: string): Set<string> {
  const defaultDirs = ['node_modules', '.git'];
  if (!rawInput) return new Set(defaultDirs);

  const parsed = rawInput
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return new Set([...defaultDirs, ...parsed]);
}

/**
 * Parses comma-separated file extensions into a normalized Set of lowercase extensions (without leading dot).
 *
 * @param rawInput Raw CLI input string (e.g. "jpg,png,.gif")
 * @returns Set of normalized extensions to ignore
 */
export function parseIgnoreExts(rawInput?: string): Set<string> {
  if (!rawInput) return new Set();

  const extensions = rawInput
    .split(',')
    .map((item) => item.trim().replace(/^\./, '').toLowerCase())
    .filter((item) => item.length > 0);

  return new Set(extensions);
}

/**
 * Loads and parses .gitignore rules from a directory if the file exists.
 *
 * @param dirPath Path to directory containing .gitignore
 * @returns Array of active ignore rule strings
 */
export async function loadGitignoreRules(dirPath: string): Promise<string[]> {
  const gitignorePath = join(dirPath, '.gitignore');
  const file = Bun.file(gitignorePath);

  if (!(await file.exists())) return [];

  const text = await file.text();
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * Converts a gitignore glob pattern into a RegExp.
 *
 * @param rule Gitignore pattern line
 * @returns Compiled RegExp for matching relative paths
 */
function ruleToRegex(rule: string): RegExp {
  let pattern = rule.trim();
  const isDirOnly = pattern.endsWith('/');
  if (isDirOnly) {
    pattern = pattern.slice(0, -1);
  }

  const isAbs = pattern.startsWith('/');
  if (isAbs) {
    pattern = pattern.slice(1);
  }

  // Escape special regex characters first
  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  let prefix = isAbs ? '^' : '(?:^|/)';
  let suffix = isDirOnly ? '(?:$|/)' : '(?:$|/|\\.)';

  return new RegExp(`${prefix}${escaped}${suffix}`);
}

/**
 * Determines whether a file or directory should be ignored based on dirs, extensions, and gitignore rules.
 *
 * @param relativePath Relative path from scanning root (e.g. "sub/file.jpg")
 * @param itemName Name of the file or directory
 * @param isDirectory Whether item is a directory
 * @param ignoreDirs Set of directory names to exclude
 * @param ignoreExts Set of file extensions to exclude
 * @param gitignoreRules List of .gitignore rule strings
 * @returns True if item should be ignored
 */
export function shouldIgnoreItem(
  relativePath: string,
  itemName: string,
  isDirectory: boolean,
  ignoreDirs: Set<string>,
  ignoreExts: Set<string>,
  gitignoreRules: string[]
): boolean {
  if (isDirectory && ignoreDirs.has(itemName)) {
    return true;
  }

  if (!isDirectory && ignoreExts.size > 0) {
    const extIndex = itemName.lastIndexOf('.');
    if (extIndex !== -1) {
      const ext = itemName.slice(extIndex + 1).toLowerCase();
      if (ignoreExts.has(ext)) {
        return true;
      }
    }
  }

  const normalizedPath = relativePath.replaceAll('\\', '/');

  for (const rule of gitignoreRules) {
    const regex = ruleToRegex(rule);
    if (regex.test(normalizedPath)) {
      return true;
    }
  }

  return false;
}
