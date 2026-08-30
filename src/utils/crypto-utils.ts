const SALT_BYTE_LENGTH = 16;
const IV_BYTE_LENGTH = 12;
const KEY_DERIVATION_ITERATIONS = 100000;

/**
 * Ensures a Uint8Array has a standard ArrayBuffer for WebCrypto API compatibility.
 */
function toStandardBuffer(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(data.byteLength);
  const view = new Uint8Array(buf);
  view.set(data);
  return view as Uint8Array<ArrayBuffer>;
}

/**
 * Derives an AES-256-GCM CryptoKey from a password and salt using PBKDF2.
 *
 * @param password Secret password string
 * @param salt Cryptographic random salt buffer
 * @returns Derived CryptoKey instance
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);

  const saltBuffer = toStandardBuffer(salt);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: KEY_DERIVATION_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a binary Uint8Array payload using AES-256-GCM.
 * Layout: [16-byte Salt][12-byte IV][Ciphertext + Auth Tag]
 *
 * @param data Raw unencrypted bytes
 * @param password Secret passphrase
 * @returns Encrypted bytes payload
 */
export async function encryptBuffer(
  data: Uint8Array,
  password: string
): Promise<Uint8Array<ArrayBuffer>> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
  const key = await deriveKey(password, salt);

  const dataBuffer = toStandardBuffer(data);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toStandardBuffer(iv) },
    key,
    dataBuffer
  );

  const ciphertext = new Uint8Array(ciphertextBuffer);
  const result = new Uint8Array(SALT_BYTE_LENGTH + IV_BYTE_LENGTH + ciphertext.byteLength);

  result.set(salt, 0);
  result.set(iv, SALT_BYTE_LENGTH);
  result.set(ciphertext, SALT_BYTE_LENGTH + IV_BYTE_LENGTH);

  return toStandardBuffer(result);
}

/**
 * Decrypts an AES-256-GCM payload encrypted with encryptBuffer using a passphrase.
 *
 * @param encryptedData Encrypted payload containing salt, IV, and ciphertext
 * @param password Secret passphrase
 * @returns Decrypted raw bytes
 */
export async function decryptBuffer(
  encryptedData: Uint8Array,
  password: string
): Promise<Uint8Array<ArrayBuffer>> {
  if (encryptedData.byteLength < SALT_BYTE_LENGTH + IV_BYTE_LENGTH) {
    throw new Error('Invalid encrypted archive payload: Payload size is too short.');
  }

  const salt = toStandardBuffer(encryptedData.subarray(0, SALT_BYTE_LENGTH));
  const iv = toStandardBuffer(
    encryptedData.subarray(SALT_BYTE_LENGTH, SALT_BYTE_LENGTH + IV_BYTE_LENGTH)
  );
  const ciphertext = toStandardBuffer(encryptedData.subarray(SALT_BYTE_LENGTH + IV_BYTE_LENGTH));

  const key = await deriveKey(password, salt);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return toStandardBuffer(new Uint8Array(decryptedBuffer));
  } catch {
    throw new Error('Decryption failed. Incorrect password or tampered chunk archive.');
  }
}
