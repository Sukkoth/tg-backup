# tg-backup

> **Fast, intelligent folder compression and archiving CLI tool powered by Bun & TypeScript.**

`tg-backup` chunks and compresses large directories into size-bounded archives (e.g., 3 GB – 4 GB) optimized for cloud storage and messaging uploads. It features **smart bin-packing**, **large file slicing**, **SHA-256 integrity verification**, and automatic **`.gitignore` support**.

---

## Key Features

- ⚡ **Bun Native Engine**: Powered by `Bun.Archive` and streaming `Bun.CryptoHasher` for lightning-fast archiving and hashing.
- 📦 **Bin-Packing & Slicing**: Packs files into target chunk boundaries (e.g. min 3 GB, max 4 GB). Files larger than the maximum chunk size are sliced across chunk boundaries seamlessly.
- 🔐 **Self-Describing Manifest**: Embeds a `manifest.json` blueprint inside every chunk archive, mapping file paths, byte slice offsets, and original SHA-256 checksums.
- ✅ **Automated Integrity Verification**: `decode` automatically verifies SHA-256 hashes for every restored file to guarantee zero data loss.
- 🛡️ **Smart Exclusions**: Ignores `node_modules` and `.git` by default, supports custom file extension filtering (`-e jpg,png`), and respects `.gitignore` rules.
- 🔄 **Full Round-Trip CLI**: Clean `encode` and `decode` subcommands.

---

## Installation

Ensure you have [Bun](https://bun.sh) installed (version 1.0 or higher).

```bash
# Clone the repository
git clone https://github.com/your-username/tg-backup.git
cd tg-backup

# Install dependencies
bun install

# Link executable globally (optional)
bun link
```

---

## Quickstart

### 1. Create a Backup (Encode)

Compress a folder into split chunk archives (max 4 GB per chunk, target min 3 GB):

```bash
bun run src/index.ts encode -i ./my_photos -o ./backup_output -m 4G --min-size 3G
```

### 2. Restore a Backup (Decode)

Extract chunk archives back to their original folder structure and verify SHA-256 checksums:

```bash
bun run src/index.ts decode -i ./backup_output -o ./restored_photos
```

---

## CLI Reference & Options

```text
Usage: tg-backup [command] [options]

Commands:
  encode               Compress directory into split chunk archives (default)
  decode               Decompress split chunk archives & verify checksums
```

### Encode Options

| Flag                  | Short | Description                                            | Default             |
| :-------------------- | :---- | :----------------------------------------------------- | :------------------ |
| `--input <path>`      | `-i`  | Target directory to compress                           | `./`                |
| `--output <path>`     | `-o`  | Destination directory for output chunks                | `./output`          |
| `--max-size <size>`   | `-m`  | Maximum chunk archive size (e.g. `4G`, `500M`)         | `4G`                |
| `--min-size <size>`   |       | Minimum target chunk size (e.g. `3G`, `250M`)          | `3G`                |
| `--prefix <name>`     | `-p`  | Output filename prefix for chunks                      | `chunk_`            |
| `--ignore-dir <dirs>` | `-d`  | Comma-separated directory names to ignore              | `node_modules,.git` |
| `--ignore-ext <exts>` | `-e`  | Comma-separated file extensions to ignore              | _(none)_            |
| `--no-gitignore`      |       | Disable `.gitignore` rule evaluation                   | `false`             |
| `--no-compress`       |       | Create uncompressed `.tar` chunks instead of `.tar.gz` | `false`             |
| `--version`           | `-v`  | Display version number                                 |                     |
| `--help`              | `-h`  | Display help documentation                             |                     |

### Decode Options

| Flag              | Short | Description                                           | Default    |
| :---------------- | :---- | :---------------------------------------------------- | :--------- |
| `--input <path>`  | `-i`  | Directory containing chunk archives & `manifest.json` | `./`       |
| `--output <path>` | `-o`  | Target directory for restored files                   | `./output` |
| `--no-verify`     |       | Skip SHA-256 checksum verification step               | `false`    |

---

## Advanced Usage Examples

### Custom Size Boundaries (e.g., 500 MB Chunks)

```bash
tg-backup encode -i ./large_dataset -o ./chunks -m 500M --min-size 300M
```

### Exclude Media Extensions & Specific Folders

```bash
tg-backup encode -i ./workspace -o ./chunks -d node_modules,.git,dist -e jpg,png,mp4
```

### Decode without Integrity Check (Fast Restore)

```bash
tg-backup decode -i ./chunks -o ./restored --no-verify
```

---

## How It Works

### Bin-Packing & Large File Slicing Algorithm

1. **Directory Traversal**: Scans the source directory recursively, applying ignore filters and `.gitignore` rules.
2. **SHA-256 Hashing**: Computes streaming SHA-256 hashes using `Bun.CryptoHasher`.
3. **Batch Accumulation**: Files are accumulated into a chunk batch until the size falls within `[min-size, max-size]`.
4. **Large File Slicing**: If a single file exceeds `max-size`, it is stream-sliced across consecutive chunks (`file.part001`, `file.part002`).
5. **Archive Generation**: Generates compressed `.tar.gz` archives using `Bun.Archive` and embeds `manifest.json` into every chunk.

```
[ Input Directory ] ---> [ Scanner & Hasher ] ---> [ Bin-Packer & Slicer ]
                                                             |
                                                             v
                                        [ chunk_001.tar.gz ] [ chunk_002.tar.gz ]
                                        (with manifest.json embedded in each)
```

---

## Development & Testing

```bash
# Run unit & end-to-end integration tests
bun test

# Run TypeScript type check (tsc --noEmit)
bun run typecheck

# Run Prettier code formatting
bun run format
```

---

## License

[MIT](LICENSE)
