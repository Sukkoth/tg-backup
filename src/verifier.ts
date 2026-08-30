import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Manifest } from './types/manifest.ts';
import { decryptBuffer } from './utils/crypto-utils.ts';
import { formatBytes } from './utils/size-utils.ts';
import { ProgressBar } from './utils/progress-utils.ts';

export interface VerifyOptions {
  inputDir: string;
  password?: string;
  progress?: boolean;
}

/**
 * Loads the manifest file from the input directory or extracts it from an available chunk archive.
 *
 * @param inputDir Directory containing chunk archives and manifest.json
 * @param password Secret password if backup is encrypted
 * @returns Parsed Manifest object
 */
async function loadManifestForVerification(inputDir: string, password?: string): Promise<Manifest> {
  const manifestGzPath = join(inputDir, 'manifest.json.gz');
  const manifestGzFile = Bun.file(manifestGzPath);

  if (await manifestGzFile.exists()) {
    const compressedBytes = await manifestGzFile.bytes();
    const decompressedBytes = Bun.gunzipSync(compressedBytes);
    const text = new TextDecoder().decode(decompressedBytes);
    return JSON.parse(text) as Manifest;
  }

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
    let bytes: Uint8Array<ArrayBuffer> = await chunkFile.bytes();

    if (password) {
      bytes = await decryptBuffer(bytes, password);
    }

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
 * Verifies chunk archive files in-place without extracting files to disk.
 *
 * @param options Verification configuration parameters
 */
export async function verifyBackupInPlace(options: VerifyOptions): Promise<Manifest> {
  const { inputDir, password, progress = true } = options;

  console.log(`[INFO] Reading manifest from: ${inputDir}`);
  const manifest = await loadManifestForVerification(inputDir, password);

  console.log(
    `[INFO] Manifest loaded (Backup ID: ${manifest.backupId}, ${manifest.totalFiles} files, ${manifest.chunkCount} chunks).`
  );

  const progressBar = new ProgressBar('Verifying chunk archives', manifest.chunkCount, progress);
  let verifiedChunks = 0;
  let corruptedChunks = 0;

  for (let i = 0; i < manifest.chunks.length; i++) {
    const chunkMeta = manifest.chunks[i]!;
    const chunkPath = join(inputDir, chunkMeta.filename);
    const chunkFile = Bun.file(chunkPath);

    if (!(await chunkFile.exists())) {
      console.error(`[ERROR] Missing chunk archive: "${chunkMeta.filename}"`);
      corruptedChunks++;
      continue;
    }

    try {
      let archiveBytes: Uint8Array<ArrayBuffer> = await chunkFile.bytes();

      if (password) {
        archiveBytes = await decryptBuffer(archiveBytes, password);
      }

      const archive = new Bun.Archive(archiveBytes);
      const files = await archive.files();

      if (files.size === 0) {
        console.error(
          `[ERROR] Chunk archive "${chunkMeta.filename}" contains no valid archive files.`
        );
        corruptedChunks++;
      } else {
        verifiedChunks++;
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ERROR] Failed reading chunk "${chunkMeta.filename}": ${errMsg}`);
      corruptedChunks++;
    }

    progressBar.update(i + 1);
  }

  progressBar.finish();

  console.log(`--------------------------------------------------`);
  console.log(`[SUMMARY] In-Place Chunk Verification:`);
  console.log(`  - Total Chunks Inspected : ${manifest.chunkCount}`);
  console.log(`  - Total Original Files   : ${manifest.totalFiles}`);
  console.log(`  - Total Original Size    : ${formatBytes(manifest.totalSizeBytes)}`);
  console.log(`  - Verified Healthy Chunks: ${verifiedChunks}`);
  console.log(`  - Corrupted/Missing Chunks: ${corruptedChunks}`);
  console.log(`--------------------------------------------------`);

  if (corruptedChunks > 0) {
    throw new Error(
      `In-place verification failed (${corruptedChunks} corrupted/missing chunk archives).`
    );
  }

  console.log(
    `[SUCCESS] Backup in-place verification passed! All ${verifiedChunks} chunk archives are healthy.`
  );
  return manifest;
}
