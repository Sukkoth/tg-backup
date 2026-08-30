/**
 * Parses human-readable size strings (e.g. "4G", "4GB", "500M", "1024K", "100") into bytes.
 *
 * @param sizeStr Size representation string
 * @returns Size in bytes
 */
export function parseSizeString(sizeStr: string): number {
  const trimmed = sizeStr.trim().toUpperCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([KMGT]?B?)?$/);

  if (!match) {
    throw new Error(
      `Invalid size format: "${sizeStr}". Expected formats like "4G", "500M", "1024K".`
    );
  }

  const value = parseFloat(match[1] ?? '0');
  const unit = match[2] ?? '';

  switch (unit) {
    case 'T':
    case 'TB':
      return Math.round(value * 1024 * 1024 * 1024 * 1024);
    case 'G':
    case 'GB':
      return Math.round(value * 1024 * 1024 * 1024);
    case 'M':
    case 'MB':
      return Math.round(value * 1024 * 1024);
    case 'K':
    case 'KB':
      return Math.round(value * 1024);
    case 'B':
    case '':
      return Math.round(value);
    default:
      throw new Error(`Unsupported size unit: "${unit}"`);
  }
}

/**
 * Formats byte counts into human-readable string representations.
 *
 * @param bytes Number of bytes
 * @returns Human-readable size string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);

  return `${val.toFixed(2)} ${units[i] ?? 'B'}`;
}
