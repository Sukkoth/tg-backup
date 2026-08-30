/**
 * Information about a file segment placed inside a chunk archive.
 */
export interface FilePart {
  chunkIndex: number;
  internalPath: string;
  startByte: number;
  endByte: number;
}

/**
 * Metadata for an original file backed up in the archive.
 */
export interface FileEntry {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
  parts: FilePart[];
}

/**
 * Summary metadata for an individual output chunk file.
 */
export interface ChunkMetadata {
  index: number;
  filename: string;
  sizeBytes: number;
  fileCount: number;
}

/**
 * Root manifest structure for backup decoding and integrity verification.
 */
export interface Manifest {
  version: string;
  backupId: string;
  createdAt: string;
  totalFiles: number;
  totalSizeBytes: number;
  chunkCount: number;
  chunks: ChunkMetadata[];
  files: FileEntry[];
}
