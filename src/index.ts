#!/usr/bin/env bun
import { parseArgs } from 'util';
import pkg from '../package.json';
import { parseSizeString } from './utils/size-utils.ts';
import { parseIgnoreDirs, parseIgnoreExts } from './utils/ignore-utils.ts';
import { encodeBackup } from './encoder.ts';
import { decodeBackup } from './decoder.ts';
import { verifyBackupInPlace } from './verifier.ts';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: Bun.argv,
    options: {
      input: {
        type: 'string',
        short: 'i',
        default: './',
      },
      output: {
        type: 'string',
        short: 'o',
        default: './output',
      },
      'max-size': {
        type: 'string',
        short: 'm',
        default: '4G',
      },
      'min-size': {
        type: 'string',
        default: '3G',
      },
      prefix: {
        type: 'string',
        short: 'p',
        default: 'chunk_',
      },
      'ignore-dir': {
        type: 'string',
        short: 'd',
      },
      'ignore-ext': {
        type: 'string',
        short: 'e',
      },
      password: {
        type: 'string',
        short: 'k',
      },
      'dry-run': {
        type: 'boolean',
        default: false,
      },
      'no-progress': {
        type: 'boolean',
        default: false,
      },
      'no-gitignore': {
        type: 'boolean',
        default: false,
      },
      compress: {
        type: 'boolean',
        default: true,
      },
      'no-verify': {
        type: 'boolean',
        default: false,
      },
      version: {
        type: 'boolean',
        short: 'v',
        default: false,
      },
      help: {
        type: 'boolean',
        short: 'h',
        default: false,
      },
    },
    strict: false,
    allowPositionals: true,
  });

  if (values.version) {
    console.log(`${pkg.name} v${pkg.version}`);
    process.exit(0);
  }

  const rawCmd = positionals[2]?.toLowerCase();

  if (values.help) {
    console.log(`
Usage: ${pkg.name} [command] [options]

Commands:
  encode               Compress directory into split chunk archives (default)
  decode               Decompress split chunk archives & verify checksums
  verify               Verify chunk archive integrity in-place without extracting

Options:
  -i, --input <path>      Input directory (default: "./")
  -o, --output <path>     Output directory (default: "./output")
  -m, --max-size <size>   Maximum chunk size (e.g. 4G, 500M) [encode only] (default: "4G")
      --min-size <size>   Minimum chunk size [encode only] (default: "3G")
  -p, --prefix <name>     Chunk filename prefix [encode only] (default: "chunk_")
  -k, --password <pass>   AES-256-GCM encryption/decryption passphrase
      --dry-run           Preview scan & chunk allocation without writing files [encode only]
      --no-progress       Disable visual terminal progress bar
  -d, --ignore-dir <dirs> Directory names to ignore (e.g. "node_modules,.git")
  -e, --ignore-ext <exts> Extensions to ignore (e.g. "jpg,png,gif")
      --no-gitignore      Disable .gitignore rule processing
      --no-compress       Disable gzip compression [encode only]
      --no-verify         Skip SHA-256 integrity verification [decode only]
  -v, --version           Output version number
  -h, --help              Display help documentation
`);
    process.exit(0);
  }

  try {
    const showProgress = !values['no-progress'];

    if (rawCmd === 'decode') {
      await decodeBackup({
        inputDir: values.input as string,
        outputDir: values.output as string,
        verify: !values['no-verify'],
        password: values.password as string | undefined,
        progress: showProgress,
      });
    } else if (rawCmd === 'verify') {
      await verifyBackupInPlace({
        inputDir: values.input as string,
        password: values.password as string | undefined,
        progress: showProgress,
      });
    } else {
      const minSizeBytes = parseSizeString(values['min-size'] as string);
      const maxSizeBytes = parseSizeString(values['max-size'] as string);

      if (minSizeBytes > maxSizeBytes) {
        throw new Error(
          `min-size (${values['min-size']}) cannot be greater than max-size (${values['max-size']}).`
        );
      }

      const ignoreDirs = parseIgnoreDirs(values['ignore-dir'] as string | undefined);
      const ignoreExts = parseIgnoreExts(values['ignore-ext'] as string | undefined);
      const useGitignore = !values['no-gitignore'];

      await encodeBackup({
        inputDir: values.input as string,
        outputDir: values.output as string,
        minSizeBytes,
        maxSizeBytes,
        prefix: values.prefix as string,
        compress: values.compress as boolean,
        ignoreDirs,
        ignoreExts,
        useGitignore,
        password: values.password as string | undefined,
        dryRun: values['dry-run'] as boolean,
        progress: showProgress,
      });
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`[ERROR] ${error.message}`);
    } else {
      console.error(`[ERROR] ${String(error)}`);
    }
    process.exit(1);
  }
}

main();
