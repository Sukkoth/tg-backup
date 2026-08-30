import { readdir, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { FileEntry, FilePart, Manifest, ChunkMetadata } from './types/manifest.ts';
import { computeFileHash } from './utils/hash-utils.ts';
import { formatBytes } from './utils/size-utils.ts';
import { loadGitignoreRules, shouldIgnoreItem } from './utils/ignore-utils.ts';
import { encryptBuffer } from './utils/crypto-utils.ts';
import { ProgressBar } from './utils/progress-utils.ts';

export interface EncodeOptions {
  inputDir: string;
  outputDir: string;
  minSizeBytes: number;
  maxSizeBytes: number;
  prefix: string;
  compress: boolean;
  ignoreDirs?: Set<string>;
  ignoreExts?: Set<string>;
  useGitignore?: boolean;
  password?: string;
  dryRun?: boolean;
  progress?: boolean;
}

interface InternalFilePart {
  entry: FileEntry;
  internalPath: string;
  fullPath: string;
  startByte: number;
  endByte: number;
  sizeBytes: number;
}

interface ChunkBatch {
  index: number;
  parts: InternalFilePart[];
  totalBytes: number;
}

/**
 * Recursively scans the input directory and collects file information and checksums.
 *
 * @param inputDir Root directory to scan
 * @param ignoreDirs Set of directory names to skip
 * @param ignoreExts Set of file extensions to skip
 * @param useGitignore Whether to read and evaluate .gitignore rules
 * @param showProgress Whether to show terminal progress updates
 * @returns Array of file entry definitions with hashes
 */
async function scanInputDirectory(
  inputDir: string,
  ignoreDirs: Set<string> = new Set(['node_modules', '.git']),
  ignoreExts: Set<string> = new Set(),
  useGitignore: boolean = true,
  showProgress: boolean = true
): Promise<{ fullPath: string; entry: FileEntry }[]> {
  const entries: { fullPath: string; entry: FileEntry }[] = [];
  const gitignoreRules = useGitignore ? await loadGitignoreRules(inputDir) : [];

  const rawFileList: { fullPath: string; relPath: string }[] = [];

  async function collect(currentDir: string): Promise<void> {
    const dirEntries = await readdir(currentDir, { withFileTypes: true });

    for (const item of dirEntries) {
      const fullPath = join(currentDir, item.name);
      const relPath = relative(inputDir, fullPath).replaceAll('\\', '/');
      const isDir = item.isDirectory();

      if (shouldIgnoreItem(relPath, item.name, isDir, ignoreDirs, ignoreExts, gitignoreRules)) {
        continue;
      }

      if (isDir) {
        await collect(fullPath);
      } else if (item.isFile()) {
        rawFileList.push({ fullPath, relPath });
      }
    }
  }

  await collect(inputDir);

  const progressBar = new ProgressBar('Scanning & Hashing files', rawFileList.length, showProgress);

  for (let i = 0; i < rawFileList.length; i++) {
    const { fullPath, relPath } = rawFileList[i]!;
    const bunFile = Bun.file(fullPath);
    const sizeBytes = bunFile.size;
    const sha256 = await computeFileHash(fullPath);

    entries.push({
      fullPath,
      entry: {
        relativePath: relPath,
        sizeBytes,
        sha256,
        parts: [],
      },
    });

    progressBar.update(i + 1);
  }

  progressBar.finish();
  return entries;
}

/**
 * Plans chunk batches based on minimum and maximum chunk size limits.
 *
 * @param items List of scanned input files
 * @param minSizeBytes Minimum target chunk size
 * @param maxSizeBytes Maximum chunk size
 * @returns Array of organized chunk batches
 */
function planChunkBatches(
  items: { fullPath: string; entry: FileEntry }[],
  minSizeBytes: number,
  maxSizeBytes: number
): ChunkBatch[] {
  const chunks: ChunkBatch[] = [];
  let currentChunkIndex = 1;
  let currentBatch: ChunkBatch = { index: currentChunkIndex, parts: [], totalBytes: 0 };

  function pushCurrentBatch(): void {
    if (currentBatch.parts.length > 0) {
      chunks.push(currentBatch);
      currentChunkIndex++;
      currentBatch = { index: currentChunkIndex, parts: [], totalBytes: 0 };
    }
  }

  for (const item of items) {
    const { fullPath, entry } = item;
    let bytesRemaining = entry.sizeBytes;
    let currentOffset = 0;

    if (entry.sizeBytes === 0) {
      const partPath = `files/${entry.relativePath}`;
      const part: InternalFilePart = {
        entry,
        internalPath: partPath,
        fullPath,
        startByte: 0,
        endByte: 0,
        sizeBytes: 0,
      };
      currentBatch.parts.push(part);
      continue;
    }

    while (bytesRemaining > 0) {
      const spaceInCurrentChunk = maxSizeBytes - currentBatch.totalBytes;

      if (spaceInCurrentChunk <= 0 && currentBatch.totalBytes >= minSizeBytes) {
        pushCurrentBatch();
      }

      const availableSpace = maxSizeBytes - currentBatch.totalBytes;
      const sliceSize = Math.min(bytesRemaining, availableSpace);

      const isSlice = entry.sizeBytes > sliceSize;
      const internalPath = isSlice
        ? `slices/${entry.relativePath}.part${currentOffset}-${currentOffset + sliceSize}`
        : `files/${entry.relativePath}`;

      const part: InternalFilePart = {
        entry,
        internalPath,
        fullPath,
        startByte: currentOffset,
        endByte: currentOffset + sliceSize,
        sizeBytes: sliceSize,
      };

      currentBatch.parts.push(part);
      currentBatch.totalBytes += sliceSize;
      currentOffset += sliceSize;
      bytesRemaining -= sliceSize;

      if (currentBatch.totalBytes >= maxSizeBytes) {
        pushCurrentBatch();
      }
    }
  }

  pushCurrentBatch();
  return chunks;
}

/**
 * Encodes a directory into split chunk archives according to configured size boundaries.
 *
 * @param options Encoding configuration parameters
 */
export async function encodeBackup(options: EncodeOptions): Promise<Manifest> {
  const {
    inputDir,
    outputDir,
    minSizeBytes,
    maxSizeBytes,
    prefix,
    compress,
    password,
    dryRun = false,
    progress = true,
  } = options;

  console.log(`[INFO] Scanning directory: ${inputDir}`);
  const scannedItems = await scanInputDirectory(
    inputDir,
    options.ignoreDirs,
    options.ignoreExts,
    options.useGitignore,
    progress
  );

  if (scannedItems.length === 0) {
    console.log(`[WARN] Input directory "${inputDir}" contains no matching files.`);
    if (!dryRun) {
      await mkdir(outputDir, { recursive: true });
      const manifestPathGz = join(outputDir, 'manifest.json.gz');
      const emptyManifest: Manifest = {
        version: '1.0.0',
        backupId: `backup-${Date.now()}`,
        createdAt: new Date().toISOString(),
        totalFiles: 0,
        totalSizeBytes: 0,
        chunkCount: 0,
        encrypted: !!password,
        chunks: [],
        files: [],
      };
      const jsonBytes = new TextEncoder().encode(JSON.stringify(emptyManifest));
      await Bun.write(manifestPathGz, Bun.gzipSync(jsonBytes));
      return emptyManifest;
    }
  }

  console.log(`[INFO] Found ${scannedItems.length} files. Planning chunk batches...`);
  const batches = planChunkBatches(scannedItems, minSizeBytes, maxSizeBytes);
  const totalSizeBytes = scannedItems.reduce((acc, item) => acc + item.entry.sizeBytes, 0);

  if (dryRun) {
    console.log(`--------------------------------------------------`);
    console.log(`[DRY-RUN MODE] Planned Backup Allocation:`);
    console.log(`  - Source Directory      : ${inputDir}`);
    console.log(`  - Target Output Directory: ${outputDir}`);
    console.log(`  - Total Matching Files  : ${scannedItems.length}`);
    console.log(`  - Total Original Size   : ${formatBytes(totalSizeBytes)}`);
    console.log(`  - Planned Chunk Count   : ${batches.length}`);
    console.log(
      `  - Target Chunk Bounds   : [${formatBytes(minSizeBytes)}, ${formatBytes(maxSizeBytes)}]`
    );
    console.log(`  - Encryption Enabled    : ${password ? 'YES (AES-256-GCM)' : 'NO'}`);
    console.log(`--------------------------------------------------`);
    console.log(`[INFO] Dry-run complete. No files were written to disk.`);

    return {
      version: '1.0.0',
      backupId: `dry-run-${Date.now()}`,
      createdAt: new Date().toISOString(),
      totalFiles: scannedItems.length,
      totalSizeBytes,
      chunkCount: batches.length,
      encrypted: !!password,
      chunks: batches.map((b) => ({
        index: b.index,
        filename: `${prefix}${String(b.index).padStart(3, '0')}${compress ? '.tar.gz' : '.tar'}`,
        sizeBytes: b.totalBytes,
        fileCount: b.parts.length,
      })),
      files: scannedItems.map((i) => i.entry),
    };
  }

  await mkdir(outputDir, { recursive: true });

  const backupId = `backup-${Date.now()}`;
  const extension = compress ? '.tar.gz' : '.tar';

  for (const batch of batches) {
    for (const part of batch.parts) {
      const isDefaultPath = part.internalPath === `files/${part.entry.relativePath}`;
      const isFullSlice = part.startByte === 0 && part.endByte === part.entry.sizeBytes;

      const filePartRecord: FilePart = {
        chunkIndex: batch.index,
      };

      if (!isDefaultPath) {
        filePartRecord.internalPath = part.internalPath;
      }
      if (!isFullSlice) {
        filePartRecord.startByte = part.startByte;
        filePartRecord.endByte = part.endByte;
      }

      part.entry.parts.push(filePartRecord);
    }
  }

  const manifestChunks: ChunkMetadata[] = batches.map((batch) => ({
    index: batch.index,
    filename: `${prefix}${String(batch.index).padStart(3, '0')}${extension}`,
    sizeBytes: batch.totalBytes,
    fileCount: batch.parts.length,
  }));

  const manifest: Manifest = {
    version: '1.0.0',
    backupId,
    createdAt: new Date().toISOString(),
    totalFiles: scannedItems.length,
    totalSizeBytes,
    chunkCount: batches.length,
    encrypted: !!password,
    chunks: manifestChunks,
    files: scannedItems.map((item) => item.entry),
  };

  const progressBar = new ProgressBar('Writing chunk archives', batches.length, progress);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const chunkFilename = `${prefix}${String(batch.index).padStart(3, '0')}${extension}`;
    const chunkOutputPath = join(outputDir, chunkFilename);

    const archiveRecords: Record<string, Blob | string | Uint8Array> = {};

    for (const part of batch.parts) {
      const bunFile = Bun.file(part.fullPath);
      const sliceBlob =
        part.sizeBytes > 0 ? bunFile.slice(part.startByte, part.endByte) : new Blob([]);
      const sliceBytes = await sliceBlob.bytes();

      archiveRecords[part.internalPath] = sliceBytes;
    }

    archiveRecords['manifest.json'] = JSON.stringify(manifest);

    const archiveOptions = compress ? { compress: 'gzip' as const } : undefined;
    const archive = new Bun.Archive(archiveRecords, archiveOptions);
    let outputBytes: Uint8Array = await archive.bytes();

    if (password) {
      outputBytes = await encryptBuffer(outputBytes, password);
    }

    await Bun.write(chunkOutputPath, outputBytes);

    const writtenChunkFile = Bun.file(chunkOutputPath);
    const chunkSizeBytes = writtenChunkFile.size;

    const chunkMeta = manifestChunks.find((c) => c.index === batch.index);
    if (chunkMeta) {
      chunkMeta.sizeBytes = chunkSizeBytes;
    }

    progressBar.update(i + 1);
  }

  progressBar.finish();

  const manifestPathGz = join(outputDir, 'manifest.json.gz');
  const manifestJsonBytes = new TextEncoder().encode(JSON.stringify(manifest));
  await Bun.write(manifestPathGz, Bun.gzipSync(manifestJsonBytes));

  console.log(`[SUCCESS] Backup completed!`);
  console.log(`  - Total Chunks: ${manifest.chunkCount}`);
  console.log(`  - Total Files: ${manifest.totalFiles}`);
  console.log(`  - Total Original Size: ${formatBytes(manifest.totalSizeBytes)}`);
  console.log(`  - Encryption: ${password ? 'AES-256-GCM' : 'None'}`);
  console.log(`  - Manifest saved to: ${manifestPathGz}`);

  return manifest;
}
