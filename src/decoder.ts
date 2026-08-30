import { mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Manifest, FileEntry } from './types/manifest.ts';
import { computeFileHash } from './utils/hash-utils.ts';
import { sanitizePathForOS, resolveCaseCollision } from './utils/path-utils.ts';

export interface DecodeOptions {
  inputDir: string;
  outputDir: string;
  verify?: boolean;
}

/**
 * Loads the manifest file from the input directory or extracts it from an available chunk archive.
 *
 * @param inputDir Directory containing chunk archives and manifest.json
 * @returns Parsed Manifest object
 */
async function loadManifest(inputDir: string): Promise<Manifest> {
  const manifestPath = join(inputDir, 'manifest.json');
  const standaloneFile = Bun.file(manifestPath);

  if (await standaloneFile.exists()) {
    const text = await standaloneFile.text();
    return JSON.parse(text) as Manifest;
  }

  const dirEntries = await readdir(inputDir, { withFileTypes: true });
  const archiveEntry = dirEntries.find(
    (item) => item.isFile() && (item.name.endsWith('.tar.gz') || item.name.endsWith('.tar'))
  );

  if (archiveEntry) {
    const chunkPath = join(inputDir, archiveEntry.name);
    const chunkFile = Bun.file(chunkPath);
    const bytes = await chunkFile.bytes();
    const archive = new Bun.Archive(bytes);
    const files = await archive.files();
    const manifestBlob = files.get('manifest.json');

    if (manifestBlob) {
      const text = await manifestBlob.text();
      return JSON.parse(text) as Manifest;
    }
  }

  throw new Error(
    `Manifest file not found in "${inputDir}". Ensure manifest.json or a valid chunk archive is present.`
  );
}

/**
 * Performs best-effort decoding of a backup, extracting all healthy files from available chunks,
 * applying cross-platform path sanitization, verifying checksums, and reporting results.
 *
 * @param options Decode configuration options
 */
export async function decodeBackup(options: DecodeOptions): Promise<void> {
  const { inputDir, outputDir, verify = true } = options;

  console.log(`[INFO] Loading manifest from: ${inputDir}`);
  const manifest = await loadManifest(inputDir);

  console.log(
    `[INFO] Manifest loaded (Backup ID: ${manifest.backupId}, ${manifest.totalFiles} files, ${manifest.chunkCount} chunks).`
  );

  const chunkFilesMap = new Map<number, Map<string, File>>();
  const missingChunkIndices = new Set<number>();

  for (const chunkMeta of manifest.chunks) {
    const chunkPath = join(inputDir, chunkMeta.filename);
    const chunkFile = Bun.file(chunkPath);

    if (await chunkFile.exists()) {
      console.log(
        `[INFO] Reading Chunk ${chunkMeta.index}/${manifest.chunkCount}: ${chunkMeta.filename}...`
      );
      const archiveBytes = await chunkFile.bytes();
      const archive = new Bun.Archive(archiveBytes);
      const files = await archive.files();
      chunkFilesMap.set(chunkMeta.index, files);
    } else {
      console.warn(
        `[WARN] Missing chunk archive: "${chunkMeta.filename}". Files in this chunk will be skipped.`
      );
      missingChunkIndices.add(chunkMeta.index);
    }
  }

  if (chunkFilesMap.size === 0) {
    throw new Error(
      `No valid chunk archive files found in "${inputDir}". Cannot extract any files.`
    );
  }

  await mkdir(outputDir, { recursive: true });

  console.log(`[INFO] Restoring healthy files to: ${outputDir}`);

  let restoredCount = 0;
  let skippedCount = 0;
  const extractedFilesList: { entry: FileEntry; finalPath: string }[] = [];
  const extractedCaseMap = new Map<string, string>();

  for (const fileEntry of manifest.files) {
    const sortedParts = [...fileEntry.parts].sort((a, b) => a.startByte - b.startByte);

    const hasMissingPart = sortedParts.some(
      (part) =>
        missingChunkIndices.has(part.chunkIndex) ||
        !chunkFilesMap.get(part.chunkIndex)?.has(part.internalPath)
    );

    if (hasMissingPart) {
      console.warn(
        `[WARN] Skipping "${fileEntry.relativePath}": one or more chunk parts are missing.`
      );
      skippedCount++;
      continue;
    }

    const { sanitizedPath, wasSanitized } = sanitizePathForOS(fileEntry.relativePath);
    const { finalPath, hadCollision } = resolveCaseCollision(sanitizedPath, extractedCaseMap);

    if (wasSanitized) {
      console.warn(
        `[WARN] Sanitized Windows-invalid path: "${fileEntry.relativePath}" -> "${finalPath}"`
      );
    } else if (hadCollision) {
      console.warn(`[WARN] Resolved case collision: "${fileEntry.relativePath}" -> "${finalPath}"`);
    }

    const targetPath = join(outputDir, finalPath);
    await mkdir(dirname(targetPath), { recursive: true });

    if (
      sortedParts.length === 1 &&
      sortedParts[0]?.startByte === 0 &&
      sortedParts[0]?.endByte === fileEntry.sizeBytes
    ) {
      const part = sortedParts[0];
      const archiveFiles = chunkFilesMap.get(part.chunkIndex);
      const fileBlob = archiveFiles?.get(part.internalPath);

      if (fileBlob) {
        await Bun.write(targetPath, fileBlob);
        restoredCount++;
        extractedFilesList.push({ entry: fileEntry, finalPath });
      }
    } else {
      const fileWriter = Bun.file(targetPath).writer();
      let assembleSuccess = true;

      for (const part of sortedParts) {
        const archiveFiles = chunkFilesMap.get(part.chunkIndex);
        const partBlob = archiveFiles?.get(part.internalPath);

        if (partBlob) {
          const arrayBuf = await partBlob.arrayBuffer();
          fileWriter.write(arrayBuf);
        } else {
          assembleSuccess = false;
          break;
        }
      }

      await fileWriter.end();

      if (assembleSuccess) {
        restoredCount++;
        extractedFilesList.push({ entry: fileEntry, finalPath });
      } else {
        console.warn(`[WARN] Failed reassembling split slices for "${fileEntry.relativePath}".`);
        skippedCount++;
      }
    }
  }

  let verifiedCount = 0;
  let corruptedCount = 0;

  if (verify && extractedFilesList.length > 0) {
    console.log(
      `[INFO] Verifying SHA-256 integrity checksums for ${extractedFilesList.length} restored files...`
    );

    for (const item of extractedFilesList) {
      const targetPath = join(outputDir, item.finalPath);
      const computedHash = await computeFileHash(targetPath);

      if (computedHash === item.entry.sha256) {
        verifiedCount++;
      } else {
        console.error(
          `[ERROR] Checksum mismatch for "${item.entry.relativePath}"! Expected ${item.entry.sha256}, got ${computedHash}`
        );
        corruptedCount++;
      }
    }
  } else if (!verify) {
    verifiedCount = restoredCount;
  }

  console.log(`--------------------------------------------------`);
  console.log(`[SUMMARY] Restoration Summary:`);
  console.log(`  - Verified Healthy Restored Files : ${verifiedCount}`);
  console.log(`  - Corrupted Checksum Files        : ${corruptedCount}`);
  console.log(`  - Skipped (Missing Chunks/Slices) : ${skippedCount}`);
  console.log(`--------------------------------------------------`);

  if (corruptedCount > 0 || skippedCount > 0 || missingChunkIndices.size > 0) {
    throw new Error(
      `Backup decoding completed with errors: ${verifiedCount} healthy, ${corruptedCount} corrupted, ${skippedCount} skipped.`
    );
  }

  console.log(
    `[SUCCESS] All ${verifiedCount} files restored and SHA-256 checksums verified successfully!`
  );
}
