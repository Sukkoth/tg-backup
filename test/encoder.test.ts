import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { rm, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSizeString, formatBytes } from '../src/utils/size-utils.ts';
import { parseIgnoreDirs, parseIgnoreExts, shouldIgnoreItem } from '../src/utils/ignore-utils.ts';
import {
  sanitizeSegmentForWindows,
  sanitizePathForOS,
  resolveCaseCollision,
} from '../src/utils/path-utils.ts';
import { encryptBuffer, decryptBuffer } from '../src/utils/crypto-utils.ts';
import { computeFileHash } from '../src/utils/hash-utils.ts';
import { encodeBackup } from '../src/encoder.ts';
import { decodeBackup } from '../src/decoder.ts';
import { verifyBackupInPlace } from '../src/verifier.ts';

describe('Size Utils', () => {
  test('parses size strings correctly', () => {
    expect(parseSizeString('4G')).toBe(4 * 1024 * 1024 * 1024);
    expect(parseSizeString('500M')).toBe(500 * 1024 * 1024);
    expect(parseSizeString('1024K')).toBe(1024 * 1024);
    expect(parseSizeString('100B')).toBe(100);
  });

  test('throws on invalid size string or unit', () => {
    expect(() => parseSizeString('invalid')).toThrow();
  });

  test('formats bytes correctly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
    expect(formatBytes(4.5 * 1024 * 1024 * 1024)).toBe('4.50 GB');
  });
});

describe('Crypto Utils', () => {
  test('encrypts and decrypts buffer with matching password', async () => {
    const originalText = 'Super Secret Data Payload 12345';
    const enc = new TextEncoder();
    const data = enc.encode(originalText);
    const password = 'mysecretpassword';

    const encrypted = await encryptBuffer(data, password);
    expect(encrypted.byteLength).toBeGreaterThan(data.byteLength);

    const decrypted = await decryptBuffer(encrypted, password);
    const dec = new TextDecoder();
    expect(dec.decode(decrypted)).toBe(originalText);
  });

  test('throws error on incorrect decryption password', async () => {
    const enc = new TextEncoder();
    const data = enc.encode('Secret Data');
    const encrypted = await encryptBuffer(data, 'rightpassword');

    expect(decryptBuffer(encrypted, 'wrongpassword')).rejects.toThrow();
  });
});

describe('Ignore Utils', () => {
  test('parses ignore dirs', () => {
    const dirs = parseIgnoreDirs('build,dist');
    expect(dirs.has('node_modules')).toBe(true);
    expect(dirs.has('.git')).toBe(true);
    expect(dirs.has('build')).toBe(true);
    expect(dirs.has('dist')).toBe(true);
  });

  test('parses ignore extensions', () => {
    const exts = parseIgnoreExts('jpg,.PNG, gif ');
    expect(exts.has('jpg')).toBe(true);
    expect(exts.has('png')).toBe(true);
    expect(exts.has('gif')).toBe(true);
    expect(exts.has('txt')).toBe(false);
  });

  test('evaluates shouldIgnoreItem correctly', () => {
    const ignoreDirs = new Set(['node_modules', '.git']);
    const ignoreExts = new Set(['jpg', 'log']);
    const gitignoreRules = ['*.tmp', 'secret/'];

    expect(
      shouldIgnoreItem('node_modules', 'node_modules', true, ignoreDirs, ignoreExts, gitignoreRules)
    ).toBe(true);
    expect(
      shouldIgnoreItem('photo.jpg', 'photo.jpg', false, ignoreDirs, ignoreExts, gitignoreRules)
    ).toBe(true);
    expect(
      shouldIgnoreItem('debug.tmp', 'debug.tmp', false, ignoreDirs, ignoreExts, gitignoreRules)
    ).toBe(true);
    expect(
      shouldIgnoreItem('photo.png', 'photo.png', false, ignoreDirs, ignoreExts, gitignoreRules)
    ).toBe(false);
  });
});

describe('Path Utils', () => {
  test('sanitizes Windows illegal characters', () => {
    expect(sanitizeSegmentForWindows('log:12:30.txt')).toBe('log%3A12%3A30.txt');
    expect(sanitizeSegmentForWindows('file*.png')).toBe('file%2A.png');
    expect(sanitizeSegmentForWindows('query?.json')).toBe('query%3F.json');
  });

  test('sanitizes relative paths in Windows mode', () => {
    const { sanitizedPath, wasSanitized } = sanitizePathForOS('logs/app:12:30.log', true);
    expect(wasSanitized).toBe(true);
    expect(sanitizedPath).toBe('logs/app%3A12%3A30.log');
  });

  test('resolves case collisions on case-insensitive filesystems', () => {
    const caseMap = new Map<string, string>();
    const res1 = resolveCaseCollision('photo.jpg', caseMap);
    const res2 = resolveCaseCollision('Photo.jpg', caseMap);

    expect(res1.hadCollision).toBe(false);
    expect(res1.finalPath).toBe('photo.jpg');

    expect(res2.hadCollision).toBe(true);
    expect(res2.finalPath).toContain('Photo__case');
  });
});

describe('Telegram Utils', () => {
  test('throws descriptive error if upload file does not exist', async () => {
    const { sendTelegramDocument } = await import('../src/utils/telegram-utils.ts');
    expect(sendTelegramDocument('token', 'chatid', '/non/existent/file.bin')).rejects.toThrow();
  });
});

describe('MTProto Utils', () => {
  test('throws error if apiId or apiHash is missing', async () => {
    const { createMTProtoClient } = await import('../src/utils/mtproto-utils.ts');
    expect(createMTProtoClient(0, '')).rejects.toThrow();
  });
});

describe('Cloud Provider Architecture', () => {
  test('uploadBackup throws error for unsupported provider', async () => {
    const { uploadBackup } = await import('../src/uploader.ts');
    expect(uploadBackup({ chunkDir: './', provider: 'invalid_provider' })).rejects.toThrow();
  });

  test('downloadBackup throws error for unsupported provider', async () => {
    const { downloadBackup } = await import('../src/downloader.ts');
    expect(downloadBackup({ targetDir: './', provider: 'invalid_provider' })).rejects.toThrow();
  });
});

describe('Encoder & Decoder Round-Trip Test (Synthetic Data)', () => {
  const testInputDir = join(import.meta.dir, 'fixtures/input');
  const testOutputDir = join(import.meta.dir, 'fixtures/chunks-output');
  const testRestoredDir = join(import.meta.dir, 'fixtures/restored-output');

  afterAll(async () => {
    await rm(join(import.meta.dir, 'fixtures'), { recursive: true, force: true });
  });

  test('encodes and decodes synthetic directory with exact byte match', async () => {
    await mkdir(join(testInputDir, 'subfolder'), { recursive: true });
    await mkdir(join(testInputDir, 'node_modules'), { recursive: true });

    const file1Content = 'Hello World file 1!';
    const file2Content = 'Hello World inside subfolder file 2!';
    await Bun.write(join(testInputDir, 'file1.txt'), file1Content);
    await Bun.write(join(testInputDir, 'subfolder/file2.txt'), file2Content);
    await Bun.write(join(testInputDir, 'node_modules/ignored.js'), 'console.log("ignored");');
    await Bun.write(join(testInputDir, 'file1.log'), 'log data');

    await Bun.write(join(testInputDir, 'empty.txt'), '');
    await Bun.write(join(testInputDir, '.gitignore'), '*.log\n');

    const buffer = new Uint8Array(10 * 1024 * 1024);
    buffer.fill(65);
    await Bun.write(join(testInputDir, 'large-file.bin'), buffer);

    const manifest = await encodeBackup({
      inputDir: testInputDir,
      outputDir: testOutputDir,
      minSizeBytes: 2 * 1024 * 1024,
      maxSizeBytes: 4 * 1024 * 1024,
      prefix: 'synth_chunk_',
      compress: true,
      useGitignore: true,
      progress: false,
    });

    expect(manifest.totalFiles).toBe(5);

    await decodeBackup({
      inputDir: testOutputDir,
      outputDir: testRestoredDir,
      verify: true,
      progress: false,
    });

    expect(await Bun.file(join(testRestoredDir, 'file1.txt')).text()).toBe(file1Content);

    const originalHash = await computeFileHash(join(testInputDir, 'large-file.bin'));
    const restoredHash = await computeFileHash(join(testRestoredDir, 'large-file.bin'));
    expect(restoredHash).toBe(originalHash);
  });

  test('performs in-place verification using verifyBackupInPlace', async () => {
    const manifest = await verifyBackupInPlace({
      inputDir: testOutputDir,
      progress: false,
    });
    expect(manifest.totalFiles).toBe(5);
  });

  test('previews allocation without writing files in dry-run mode', async () => {
    const dryRunDir = join(import.meta.dir, 'fixtures/dry-run-output');

    const manifest = await encodeBackup({
      inputDir: testInputDir,
      outputDir: dryRunDir,
      minSizeBytes: 2 * 1024 * 1024,
      maxSizeBytes: 4 * 1024 * 1024,
      prefix: 'dry_chunk_',
      compress: true,
      dryRun: true,
      progress: false,
    });

    expect(manifest.totalFiles).toBe(5);
    expect(await Bun.file(join(dryRunDir, 'manifest.json')).exists()).toBe(false);
  });

  test('encodes and decodes with AES-256-GCM encryption', async () => {
    const encOutputDir = join(import.meta.dir, 'fixtures/encrypted-chunks');
    const decOutputDir = join(import.meta.dir, 'fixtures/encrypted-restored');
    const passphrase = 'testpassphrase123!';

    const manifest = await encodeBackup({
      inputDir: testInputDir,
      outputDir: encOutputDir,
      minSizeBytes: 2 * 1024 * 1024,
      maxSizeBytes: 4 * 1024 * 1024,
      prefix: 'enc_chunk_',
      compress: true,
      password: passphrase,
      progress: false,
    });

    expect(manifest.encrypted).toBe(true);

    // Fail if wrong password provided during decode
    expect(
      decodeBackup({
        inputDir: encOutputDir,
        outputDir: decOutputDir,
        password: 'wrongpassphrase',
        progress: false,
      })
    ).rejects.toThrow();

    // Succeed with correct password
    await decodeBackup({
      inputDir: encOutputDir,
      outputDir: decOutputDir,
      password: passphrase,
      progress: false,
    });

    expect(await Bun.file(join(decOutputDir, 'file1.txt')).text()).toBe('Hello World file 1!');

    await rm(encOutputDir, { recursive: true, force: true });
    await rm(decOutputDir, { recursive: true, force: true });
  });

  test('encodes and decodes with custom prefix (e.g. wedding_)', async () => {
    const customPrefixOutputDir = join(import.meta.dir, 'fixtures/custom-prefix-output');
    const customPrefixRestoredDir = join(import.meta.dir, 'fixtures/custom-prefix-restored');

    await encodeBackup({
      inputDir: testInputDir,
      outputDir: customPrefixOutputDir,
      minSizeBytes: 2 * 1024 * 1024,
      maxSizeBytes: 4 * 1024 * 1024,
      prefix: 'wedding_',
      compress: true,
      progress: false,
    });

    const manifestFile = Bun.file(join(customPrefixOutputDir, 'wedding_manifest.json.gz'));
    expect(await manifestFile.exists()).toBe(true);

    await decodeBackup({
      inputDir: customPrefixOutputDir,
      outputDir: customPrefixRestoredDir,
      verify: true,
      progress: false,
    });

    const restoredFiles = await readdir(customPrefixRestoredDir);
    expect(restoredFiles.length).toBe(5);
  });

  test('generates minified compact gzipped manifest without redundant part fields', async () => {
    const compactOutputDir = join(import.meta.dir, 'fixtures/compact-manifest-out');

    const manifest = await encodeBackup({
      inputDir: testInputDir,
      outputDir: compactOutputDir,
      minSizeBytes: 2 * 1024 * 1024,
      maxSizeBytes: 4 * 1024 * 1024,
      prefix: 'compact_chunk_',
      compress: true,
      progress: false,
    });

    const manifestGzFile = Bun.file(join(compactOutputDir, 'compact_chunk_manifest.json.gz'));
    expect(await manifestGzFile.exists()).toBe(true);

    const compressedBytes = await manifestGzFile.bytes();
    const decompressedBytes = Bun.gunzipSync(compressedBytes);
    const manifestText = new TextDecoder().decode(decompressedBytes);
    expect(manifestText).not.toContain('\n'); // Verify minified JSON inside gzip

    const unsplitFile = manifest.files.find((f) => f.relativePath === 'file1.txt');
    expect(unsplitFile).toBeDefined();

    if (unsplitFile) {
      const part = unsplitFile.parts[0];
      expect(part?.chunkIndex).toBeDefined();
      expect(part?.internalPath).toBeUndefined(); // Omitted because default "files/file1.txt"
      expect(part?.startByte).toBeUndefined(); // Omitted because default 0
      expect(part?.endByte).toBeUndefined(); // Omitted because default sizeBytes
    }

    await rm(compactOutputDir, { recursive: true, force: true });
  });

  test('decodes when standalone manifest.json.gz is removed (using embedded manifest)', async () => {
    const dirFiles = await readdir(testOutputDir);
    const standaloneManifestName = dirFiles.find((f) => f.endsWith('manifest.json.gz'))!;
    const standaloneManifestPath = join(testOutputDir, standaloneManifestName);
    const embeddedRestoredDir = join(import.meta.dir, 'fixtures/embedded-manifest-restored');

    await unlink(standaloneManifestPath);

    await decodeBackup({
      inputDir: testOutputDir,
      outputDir: embeddedRestoredDir,
      verify: true,
      progress: false,
    });

    expect(await Bun.file(join(embeddedRestoredDir, 'file1.txt')).exists()).toBe(true);

    await rm(embeddedRestoredDir, { recursive: true, force: true });
  });

  test('overwrites existing files on re-extraction without creating duplicate files', async () => {
    const overwriteRestoredDir = join(import.meta.dir, 'fixtures/overwrite-test');

    await decodeBackup({
      inputDir: testOutputDir,
      outputDir: overwriteRestoredDir,
      verify: true,
      progress: false,
    });

    await decodeBackup({
      inputDir: testOutputDir,
      outputDir: overwriteRestoredDir,
      verify: true,
      progress: false,
    });

    const file1Path = join(overwriteRestoredDir, 'file1.txt');
    expect(await Bun.file(file1Path).exists()).toBe(true);
    expect(await Bun.file(join(overwriteRestoredDir, 'file1 (2).txt')).exists()).toBe(false);

    await rm(overwriteRestoredDir, { recursive: true, force: true });
  });
});

describe('Encoder & Decoder Round-Trip Test (Real Images Zip Archive)', () => {
  const imagesZipPath = join(import.meta.dir, 'images.zip');
  const imagesDir = join(import.meta.dir, 'extracted-images');
  const imagesChunkDir = join(import.meta.dir, 'fixtures/images-chunks');
  const imagesRestoredDir = join(import.meta.dir, 'fixtures/images-restored');

  beforeAll(async () => {
    if (await Bun.file(imagesZipPath).exists()) {
      await mkdir(imagesDir, { recursive: true });
      Bun.spawnSync(['unzip', '-q', '-o', imagesZipPath, '-d', imagesDir]);
    }
  });

  afterAll(async () => {
    await rm(imagesDir, { recursive: true, force: true });
    await rm(join(import.meta.dir, 'images'), { recursive: true, force: true });
    await rm(join(import.meta.dir, 'fixtures'), { recursive: true, force: true });
  });

  test('encodes and decodes images extracted from images.zip with checksum verification', async () => {
    const manifest = await encodeBackup({
      inputDir: imagesDir,
      outputDir: imagesChunkDir,
      minSizeBytes: 3 * 1024 * 1024,
      maxSizeBytes: 5 * 1024 * 1024,
      prefix: 'img_chunk_',
      compress: true,
      progress: false,
    });

    expect(manifest.totalFiles).toBeGreaterThanOrEqual(100);
    expect(manifest.chunkCount).toBeGreaterThanOrEqual(4);

    await decodeBackup({
      inputDir: imagesChunkDir,
      outputDir: imagesRestoredDir,
      verify: true,
      progress: false,
    });

    for (const fileEntry of manifest.files) {
      const originalPath = join(imagesDir, fileEntry.relativePath);
      const restoredPath = join(imagesRestoredDir, fileEntry.relativePath);

      const originalHash = await computeFileHash(originalPath);
      const restoredHash = await computeFileHash(restoredPath);

      expect(restoredHash).toBe(originalHash);
      expect(restoredHash).toBe(fileEntry.sha256);
    }
  });
});
