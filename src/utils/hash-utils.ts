/**
 * Computes the SHA-256 checksum of a file using Bun's native CryptoHasher and streaming API.
 *
 * @param filePath Path to target file
 * @returns Hex-encoded SHA-256 checksum string
 */
export async function computeFileHash(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  const file = Bun.file(filePath);
  const stream = file.stream();

  for await (const chunk of stream) {
    hasher.update(chunk);
  }

  return hasher.digest('hex');
}
