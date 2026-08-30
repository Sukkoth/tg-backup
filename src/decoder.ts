import { mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Manifest, FileEntry } from './types/manifest.ts';
import { computeFileHash } from './utils/hash-utils.ts';

export interface DecodeOptions {
  inputDir: string;
  outputDir: string;
  verify?: boolean;
}

/**
 * Loads the manifest file from the input directory or extracts it from the first chunk archive.
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
 * Decodes and restores a backup to its original directory structure, performing SHA-256 integrity verification.
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

  for (const chunkMeta of manifest.chunks) {
    const chunkPath = join(inputDir, chunkMeta.filename);
    const chunkFile = Bun.file(chunkPath);

    if (!(await chunkFile.exists())) {
      throw new Error(`Missing required chunk archive: "${chunkMeta.filename}" in "${inputDir}".`);
    }

    console.log(
      `[INFO] Reading Chunk ${chunkMeta.index}/${manifest.chunkCount}: ${chunkMeta.filename}...`
    );
    const archiveBytes = await chunkFile.bytes();
    const archive = new Bun.Archive(archiveBytes);
    const files = await archive.files();
    chunkArchivesMapSet(chunkFilesMap, chunkMeta.index, files);
  }

  await mkdir(outputDir, { recursive: true });

  console.log(`[INFO] Extracting and reassembling ${manifest.totalFiles} files to: ${outputDir}`);

  for (let i = 0; i < manifest.files.length; i++) {
    const fileEntry = manifest.files[i] as FileEntry;
    const targetPath = join(outputDir, fileEntry.relativePath);

    await mkdir(dirname(targetPath), { recursive: true });

    const sortedParts = [...fileEntry.parts].sort((a, b) => a.startByte - b.startByte);

    if (
      sortedParts.length === 1 &&
      sortedParts[0]?.startByte === 0 &&
      sortedParts[0]?.endByte === fileEntry.sizeBytes
    ) {
      const part = sortedParts[0];
      const archiveFiles = chunkFilesMap.get(part.chunkIndex);
      const fileBlob = archiveFiles?.get(part.internalPath);

      if (!fileBlob) {
        throw new Error(
          `Part "${part.internalPath}" missing from chunk index ${part.chunkIndex} for file "${fileEntry.relativePath}".`
        );
      }

      await Bun.write(targetPath, fileBlob);
    } else {
      const fileWriter = Bun.file(targetPath).writer();

      for (const part of sortedParts) {
        const archiveFiles = chunkFilesMap.get(part.chunkIndex);
        const partBlob = archiveFiles?.get(part.internalPath);

        if (!partBlob) {
          throw new Error(
            `Slice part "${part.internalPath}" missing from chunk index ${part.chunkIndex} for file "${fileEntry.relativePath}".`
          );
        }

        const arrayBuf = await partBlob.arrayBuffer();
        fileWriter.write(arrayBuf);
      }

      await fileWriter.end();
    }
  }

  if (verify) {
    console.log(`[INFO] Verifying SHA-256 integrity checksums for ${manifest.totalFiles} files...`);

    let verifiedCount = 0;
    const failures: string[] = [];

    for (const fileEntry of manifest.files) {
      const targetPath = join(outputDir, fileEntry.relativePath);
      const computedHash = await computeFileHash(targetPath);

      if (computedHash === fileEntry.sha256) {
        verifiedCount++;
      } else {
        failures.push(
          `Checksum mismatch for "${fileEntry.relativePath}"! Expected ${fileEntry.sha256}, got ${computedHash}`
        );
      }
    }

    if (failures.length > 0) {
      console.error(`[ERROR] Verification failed for ${failures.length} file(s):`);
      for (const failure of failures) {
        console.error(`  - ${failure}`);
      }
      throw new Error(`Backup decoding failed integrity verification (${failures.length} errors).`);
    }

    console.log(`[SUCCESS] All ${verifiedCount} files restored and SHA-256 checksums verified!`);
  } else {
    console.log(`[SUCCESS] Successfully restored ${manifest.totalFiles} files to ${outputDir}.`);
  }
}

function chunkArchivesMapSet(
  map: Map<number, Map<string, File>>,
  index: number,
  files: Map<string, File>
): void {
  map.set(index, files);
}
