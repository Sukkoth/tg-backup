/**
 * Checks if the current operating system is Windows.
 */
export function isWindowsOS(): boolean {
  return process.platform === 'win32';
}

/**
 * Escapes characters that are illegal in Windows filenames (: * ? " < > |).
 *
 * @param filename File or directory segment name
 * @returns Sanitized filename string safe for Windows filesystems
 */
export function sanitizeSegmentForWindows(filename: string): string {
  let sanitized = filename
    .replaceAll(':', '%3A')
    .replaceAll('*', '%2A')
    .replaceAll('?', '%3F')
    .replaceAll('"', '%22')
    .replaceAll('<', '%3C')
    .replaceAll('>', '%3E')
    .replaceAll('|', '%7C');

  // Strip forbidden trailing dots or trailing spaces on Windows
  sanitized = sanitized.replace(/[\s.]+$/, '');

  return sanitized.length === 0 ? '_unnamed_' : sanitized;
}

/**
 * Sanitizes a relative file path for safe cross-platform extraction.
 *
 * @param relativePath Original relative path (e.g. "logs/app:12:30.log")
 * @param forceWindows Enable Windows sanitization rules regardless of host OS
 * @returns Object containing the sanitized path and whether sanitization occurred
 */
export function sanitizePathForOS(
  relativePath: string,
  forceWindows: boolean = isWindowsOS()
): { sanitizedPath: string; wasSanitized: boolean } {
  if (!forceWindows) {
    return { sanitizedPath: relativePath, wasSanitized: false };
  }

  const segments = relativePath.split('/');
  let wasSanitized = false;

  const sanitizedSegments = segments.map((segment) => {
    if (segment === '.' || segment === '..') return segment;
    const clean = sanitizeSegmentForWindows(segment);
    if (clean !== segment) wasSanitized = true;
    return clean;
  });

  return {
    sanitizedPath: sanitizedSegments.join('/'),
    wasSanitized,
  };
}

/**
 * Tracks extracted file paths and resolves case-sensitivity collisions on case-insensitive filesystems.
 *
 * @param relativePath Relative file path to extract
 * @param extractedCaseMap Map storing lowercased relative paths to original target paths
 * @returns Object containing final resolved path and whether a case collision occurred
 */
export function resolveCaseCollision(
  relativePath: string,
  extractedCaseMap: Map<string, string>
): { finalPath: string; hadCollision: boolean } {
  const lowerKey = relativePath.toLowerCase();
  const existingPath = extractedCaseMap.get(lowerKey);

  if (!existingPath || existingPath === relativePath) {
    extractedCaseMap.set(lowerKey, relativePath);
    return { finalPath: relativePath, hadCollision: false };
  }

  // Handle collision: e.g. "Photo.jpg" when "photo.jpg" already extracted
  const dotIndex = relativePath.lastIndexOf('.');
  let finalPath = '';

  if (dotIndex !== -1 && dotIndex > relativePath.lastIndexOf('/')) {
    const name = relativePath.slice(0, dotIndex);
    const ext = relativePath.slice(dotIndex);
    finalPath = `${name}__case${Date.now().toString(36)}${ext}`;
  } else {
    finalPath = `${relativePath}__case${Date.now().toString(36)}`;
  }

  extractedCaseMap.set(finalPath.toLowerCase(), finalPath);
  return { finalPath, hadCollision: true };
}
