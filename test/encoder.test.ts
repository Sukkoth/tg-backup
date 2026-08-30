import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { rm, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSizeString, formatBytes } from '../src/utils/size-utils.ts';
import { parseIgnoreDirs, parseIgnoreExts, shouldIgnoreItem } from '../src/utils/ignore-utils.ts';
import { computeFileHash } from '../src/utils/hash-utils.ts';
import { encodeBackup } from '../src/encoder.ts';
import { decodeBackup } from '../src/decoder.ts';

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

    // Create an empty file to test 0-byte file encoding/decoding
    await Bun.write(join(testInputDir, 'empty.txt'), '');

    // Create a .gitignore file inside testInputDir
    await Bun.write(join(testInputDir, '.gitignore'), '*.log\n');

    // 10MB file to force slicing across chunks
    const buffer = new Uint8Array(10 * 1024 * 1024);
    buffer.fill(65); // 'A'
    await Bun.write(join(testInputDir, 'large-file.bin'), buffer);

    const manifest = await encodeBackup({
      inputDir: testInputDir,
      outputDir: testOutputDir,
      minSizeBytes: 2 * 1024 * 1024,
      maxSizeBytes: 4 * 1024 * 1024,
      prefix: 'synth_chunk_',
      compress: true,
      useGitignore: true,
    });

    expect(manifest.totalFiles).toBe(5);
    expect(manifest.files.some((f) => f.relativePath.includes('node_modules'))).toBe(false);
    expect(manifest.files.some((f) => f.relativePath.endsWith('.log'))).toBe(false);

    await decodeBackup({
      inputDir: testOutputDir,
      outputDir: testRestoredDir,
      verify: true,
    });

    expect(await Bun.file(join(testRestoredDir, 'file1.txt')).text()).toBe(file1Content);
    expect(await Bun.file(join(testRestoredDir, 'subfolder/file2.txt')).text()).toBe(file2Content);

    const originalHash = await computeFileHash(join(testInputDir, 'large-file.bin'));
    const restoredHash = await computeFileHash(join(testRestoredDir, 'large-file.bin'));
    expect(restoredHash).toBe(originalHash);
  });

  test('decodes when standalone manifest.json is removed (using embedded manifest)', async () => {
    const standaloneManifestPath = join(testOutputDir, 'manifest.json');
    const embeddedRestoredDir = join(import.meta.dir, 'fixtures/embedded-manifest-restored');

    // Remove standalone manifest.json
    await unlink(standaloneManifestPath);

    await decodeBackup({
      inputDir: testOutputDir,
      outputDir: embeddedRestoredDir,
      verify: true,
    });

    expect(await Bun.file(join(embeddedRestoredDir, 'file1.txt')).exists()).toBe(true);

    await rm(embeddedRestoredDir, { recursive: true, force: true });
  });

  test('throws error if manifest is missing completely', async () => {
    const emptyDir = join(import.meta.dir, 'fixtures/empty-dir');
    await mkdir(emptyDir, { recursive: true });

    expect(decodeBackup({ inputDir: emptyDir, outputDir: testRestoredDir })).rejects.toThrow();
  });
});

describe('Encoder & Decoder Round-Trip Test (Real Images Zip Archive)', () => {
  const imagesZipPath = join(import.meta.dir, 'images.zip');
  const imagesDir = join(import.meta.dir, 'extracted-images');
  const imagesChunkDir = join(import.meta.dir, 'fixtures/images-chunks');
  const imagesRestoredDir = join(import.meta.dir, 'fixtures/images-restored');

  beforeAll(async () => {
    // Unzip images.zip into test/extracted-images before test runs
    if (await Bun.file(imagesZipPath).exists()) {
      await mkdir(imagesDir, { recursive: true });
      Bun.spawnSync(['unzip', '-q', '-o', imagesZipPath, '-d', imagesDir]);
    }
  });

  afterAll(async () => {
    // Clean up temporary extracted directory and chunks
    await rm(imagesDir, { recursive: true, force: true });
    await rm(imagesChunkDir, { recursive: true, force: true });
    await rm(imagesRestoredDir, { recursive: true, force: true });
  });

  test('encodes and decodes images extracted from images.zip with checksum verification', async () => {
    const manifest = await encodeBackup({
      inputDir: imagesDir,
      outputDir: imagesChunkDir,
      minSizeBytes: 3 * 1024 * 1024,
      maxSizeBytes: 5 * 1024 * 1024,
      prefix: 'img_chunk_',
      compress: true,
    });

    expect(manifest.totalFiles).toBeGreaterThanOrEqual(100);
    expect(manifest.chunkCount).toBeGreaterThanOrEqual(4);

    await decodeBackup({
      inputDir: imagesChunkDir,
      outputDir: imagesRestoredDir,
      verify: true,
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

  test('filters out files by extension (--ignore-ext jpg)', async () => {
    const filterOutputDir = join(import.meta.dir, 'fixtures/images-filtered');

    const manifest = await encodeBackup({
      inputDir: imagesDir,
      outputDir: filterOutputDir,
      minSizeBytes: 1 * 1024 * 1024,
      maxSizeBytes: 2 * 1024 * 1024,
      prefix: 'filtered_chunk_',
      compress: true,
      ignoreExts: new Set(['jpg']),
    });

    expect(manifest.totalFiles).toBe(0);

    await rm(filterOutputDir, { recursive: true, force: true });
  });
});
