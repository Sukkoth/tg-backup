# tg-backup

> High-performance, chunk-splitting backup CLI engine powered by **Bun** and **TypeScript**.

`tg-backup` splits large folders into size-bounded chunk archives (`.tar.gz`) with SHA-256 checksum verification, stream slicing, best-effort disaster recovery, cross-platform path sanitization, and optional **AES-256-GCM encryption**.

---

## Features

- **Dynamic Chunk Allocation & Bin-Packing**: Automatically packs files into chunk archives within target bounds (e.g. `3GB` - `4GB`).
- **Stream Slicing**: Large files exceeding max chunk size are sliced losslessly across chunk boundaries without high memory usage.
- **AES-256-GCM Encryption (`--password`)**: Optional passphrase encryption using PBKDF2 key derivation and WebCrypto.
- **Best-Effort Partial Recovery**: If a chunk archive is missing during extraction, `tg-backup` restores all healthy files, reports skipped/corrupted files, and exits with code `1`.
- **In-Place Verification (`verify` command)**: Check archive integrity directly on disk without extracting files.
- **Dry-Run Mode (`--dry-run`)**: Preview file counts, total size, and planned chunk allocation without writing disk files.
- **Cross-Platform Path Sanitization**: Automatically encodes Windows-illegal filename characters (`: * ? " < > |`) and resolves case-sensitivity collisions.
- **Embedded & Standalone Manifests**: `manifest.json` is saved in the output directory **and** embedded inside every `.tar.gz` chunk archive for self-describing recovery.

---

## Installation

```bash
# Clone the repository
git clone https://github.com/Sukkoth/tg-backup.git
cd tg-backup

# Install dependencies
bun install
```

---

## Quick Start & Usage

### 1. Encode (Create Backup Chunks)

```bash
# Encode directory into 500MB - 1GB compressed chunk archives
bun start encode -i ./my-folder -o ./backup-chunks --min-size 500M -m 1G
```

#### Password Encrypted Backup

```bash
bun start encode -i ./secret-photos -o ./encrypted-backup --password "MySecretPassphrase!"
```

#### Dry-Run Mode (Preview Allocation)

```bash
bun start encode -i ./large-dataset -o ./output --dry-run
```

---

### 2. Decode (Restore Backup)

```bash
# Restore files and verify SHA-256 integrity
bun start decode -i ./backup-chunks -o ./restored-folder
```

#### Decrypt Encrypted Backup

```bash
bun start decode -i ./encrypted-backup -o ./restored-folder --password "MySecretPassphrase!"
```

---

### 3. Verify Backup In-Place

```bash
# Verify chunk archive integrity in-place without extracting files to disk
bun start verify -i ./backup-chunks
```

---

## CLI Options

| Flag / Option             | Description                                                          | Command                      |
| :------------------------ | :------------------------------------------------------------------- | :--------------------------- |
| `-i, --input <path>`      | Input directory (default: `./`)                                      | `encode`, `decode`, `verify` |
| `-o, --output <path>`     | Output directory (default: `./output`)                               | `encode`, `decode`           |
| `-m, --max-size <size>`   | Maximum chunk size limit (e.g. `4G`, `500M`)                         | `encode`                     |
| `--min-size <size>`       | Minimum target chunk size (default: `3G`)                            | `encode`                     |
| `-k, --password <pass>`   | AES-256-GCM encryption/decryption passphrase                         | `encode`, `decode`, `verify` |
| `--dry-run`               | Preview file scan & allocation without writing disk archives         | `encode`                     |
| `--no-progress`           | Disable live visual terminal progress bar                            | `encode`, `decode`, `verify` |
| `-d, --ignore-dir <dirs>` | Comma-separated directories to ignore (default: `node_modules,.git`) | `encode`                     |
| `-e, --ignore-ext <exts>` | Comma-separated file extensions to ignore (e.g. `jpg,png,mp4`)       | `encode`                     |
| `--no-gitignore`          | Disable `.gitignore` rule processing                                 | `encode`                     |
| `--no-compress`           | Create `.tar` archives without Gzip compression                      | `encode`                     |
| `--no-verify`             | Skip SHA-256 checksum verification step                              | `decode`                     |

---

## Development & Testing

```bash
# Run unit & integration tests
bun test

# Run test coverage
bun test --coverage

# Typecheck TypeScript files
bun run typecheck

# Format code with Prettier
bun run format
```

---

## License

MIT
