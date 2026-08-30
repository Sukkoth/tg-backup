# tg-backup

> High-performance, chunk-splitting backup CLI engine powered by **Bun** and **TypeScript** with modular cloud storage provider architecture.

`tg-backup` splits large folders into size-bounded chunk archives (`.tar.gz`) with SHA-256 checksum verification, stream slicing, best-effort disaster recovery, cross-platform path sanitization, optional **AES-256-GCM encryption**, and decoupled **Cloud Storage Uploaders/Downloaders** (`upload` & `download` commands).

---

## Features

- **Decoupled Cloud Upload & Download (`upload` & `download`)**: Modular provider plugin system (`--provider telegram`, `--provider s3`, etc.) separating local chunk creation from cloud uploads.
- **Telegram 2GB / 4GB & 50MB Uploads**: Supports Telegram Bot API (50MB) and Telegram MTProto User API (up to 2.0GB for free accounts, 4.0GB for Telegram Premium).
- **Dynamic Chunk Allocation & Bin-Packing**: Packs files into chunk archives within target bounds (e.g. `3GB` - `4GB` or `49MB`).
- **Stream Slicing**: Large files exceeding max chunk size are sliced losslessly across chunk boundaries without high memory usage.
- **AES-256-GCM Encryption (`--password`)**: Optional passphrase encryption using PBKDF2 key derivation and WebCrypto.
- **Best-Effort Partial Recovery**: Restores all healthy files from available chunks even if a chunk is missing or corrupted.
- **In-Place Verification (`verify` command)**: Validate archive integrity on disk without extracting files.
- **Dry-Run Mode (`--dry-run`)**: Preview file counts, total size, and planned chunk allocation without writing disk files.
- **Cross-Platform Path Sanitization**: Automatically encodes Windows-illegal filename characters (`: * ? " < > |`) and resolves case collisions.
- **Compact Gzipped Manifest (`manifest.json.gz`)**: Ultra-compact manifest saved on disk and embedded in every chunk archive.

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

## Quick Start Guide

### 1. Local Offline Encoding & Decoding

```bash
# Encode directory into compressed 500MB - 1GB chunk archives
bun start encode -i ./my-folder -o ./backup-chunks --min-size 500M -m 1G --password "MyPass"

# Decode & restore files locally
bun start decode -i ./backup-chunks -o ./restored-folder --password "MyPass"

# In-place chunk verification
bun start verify -i ./backup-chunks
```

---

### 2. Uploading Chunk Folder to Telegram (`upload`)

Upload a generated local chunk folder to a private Telegram channel:

```bash
# Upload via Telegram Bot API (for chunks <= 50MB)
bun start upload -i ./backup-chunks --provider telegram \
  --telegram-token "YOUR_BOT_TOKEN" \
  --telegram-chat-id "-1001234567890"

# Upload via MTProto User API (for chunks up to 2GB / 4GB)
bun start upload -i ./backup-chunks --provider telegram \
  --api-id 1234567 \
  --api-hash "0123456789abcdef0123456789abcdef" \
  --telegram-chat-id "-1001234567890"
```

---

### 3. Downloading Backup Chunks from Telegram (`download`)

Download chunk archives from a Telegram channel into a local folder:

```bash
bun start download -o ./downloaded-chunks --provider telegram \
  --telegram-token "YOUR_BOT_TOKEN" \
  --telegram-chat-id "-1001234567890"
```

Then restore locally:

```bash
bun start decode -i ./downloaded-chunks -o ./restored-folder --password "MyPass"
```

---

## CLI Options Reference

| Command    | Subcommand Description                                                         |
| :--------- | :----------------------------------------------------------------------------- |
| `encode`   | Scans, bin-packs, stream-slices, and encrypts local folder into chunk archives |
| `decode`   | Restores healthy files from local chunk archives & verifies SHA-256 hashes     |
| `verify`   | Validates chunk archives in-place on disk without extracting                   |
| `upload`   | Uploads local chunk archives to a cloud provider (`--provider telegram`)       |
| `download` | Downloads chunk archives from a cloud provider (`--provider telegram`)         |

| Flag / Option                  | Description                                                     |
| :----------------------------- | :-------------------------------------------------------------- |
| `-i, --input <path>`           | Input directory (default: `./`)                                 |
| `-o, --output <path>`          | Output directory (default: `./output`)                          |
| `--provider <name>`            | Cloud storage provider (`telegram`)                             |
| `-m, --max-size <size>`        | Maximum chunk size limit (e.g. `2G`, `49M`, `4G`)               |
| `--min-size <size>`            | Minimum target chunk size (default: `3G`)                       |
| `-k, --password <pass>`        | AES-256-GCM encryption/decryption passphrase                    |
| `-t, --telegram-token <token>` | Telegram Bot API token (or `TELEGRAM_BOT_TOKEN` env var)        |
| `-c, --telegram-chat-id <id>`  | Telegram target chat/channel ID (or `TELEGRAM_CHAT_ID` env var) |
| `--api-id <id>`                | Telegram MTProto API ID (or `TELEGRAM_API_ID` env var)          |
| `--api-hash <hash>`            | Telegram MTProto API Hash (or `TELEGRAM_API_HASH` env var)      |
| `--session <token>`            | Telegram MTProto session string (or `TELEGRAM_SESSION` env var) |
| `--dry-run`                    | Preview file scan & allocation without writing disk archives    |
| `--no-progress`                | Disable live visual terminal progress bar                       |

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
