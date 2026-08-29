#!/usr/bin/env bun
import { parseArgs } from 'util';
import pkg from '../package.json';

function main() {
  const { values } = parseArgs({
    args: Bun.argv,
    options: {
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

  if (values.help) {
    console.log(`
Usage: ${pkg.name} [options]

Options:
  -v, --version  Output the version number
  -h, --help     Display help for command
`);
    process.exit(0);
  }

  console.log(`Hello from ${pkg.name} CLI! Use --help for available options.`);
}

main();
