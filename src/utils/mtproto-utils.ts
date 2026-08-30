import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { CustomFile } from 'telegram/client/uploads.js';
import { basename } from 'node:path';
import readline from 'node:readline';

export interface MTProtoClientResult {
  client: TelegramClient;
  session: string;
}

/**
 * Prompts user for stdin input during interactive terminal login.
 *
 * @param question Prompt text to display
 * @returns User answer string
 */
function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Creates and initializes an MTProto Telegram User API client using GramJS.
 * Automatically performs interactive phone authentication on first run if sessionString is missing.
 *
 * @param apiId Telegram API ID from my.telegram.org
 * @param apiHash Telegram API Hash from my.telegram.org
 * @param sessionString Optional existing StringSession token
 * @returns Object containing the connected TelegramClient and StringSession token
 */
export async function createMTProtoClient(
  apiId: number,
  apiHash: string,
  sessionString: string = ''
): Promise<MTProtoClientResult> {
  if (!apiId || !apiHash) {
    throw new Error('MTProto integration requires both apiId and apiHash.');
  }

  const session = new StringSession(sessionString);
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  if (!sessionString) {
    console.log('[INFO] First-time Telegram MTProto login. Completing authentication:');
    await client.start({
      phoneNumber: async () => await promptInput('Enter your phone number (e.g. +1234567890): '),
      password: async () => await promptInput('Enter 2FA password (leave empty if none): '),
      phoneCode: async () => await promptInput('Enter Telegram login code: '),
      onError: (err) => console.error('[ERROR]', err.message),
    });

    const savedSession = (client.session as StringSession).save();
    console.log('\n--------------------------------------------------');
    console.log('[SUCCESS] Telegram authentication successful!');
    console.log(`[INFO] Your session token: ${savedSession}`);
    console.log('Set TELEGRAM_SESSION in your environment to stay logged in.');
    console.log('--------------------------------------------------\n');
  } else {
    await client.connect();
  }

  return {
    client,
    session: (client.session as StringSession).save(),
  };
}

/**
 * Uploads a local chunk archive file (up to 2GB / 4GB) to a Telegram channel/chat via MTProto.
 * Supports "me" or "self" for Saved Messages.
 *
 * @param client Connected TelegramClient instance
 * @param chatId Target channel, chat, user ID, or "me" for Saved Messages
 * @param filePath Path to local file to upload
 * @param caption Optional document caption
 * @param onProgress Optional progress callback (0.0 to 1.0)
 */
export async function uploadMTProtoFile(
  client: TelegramClient,
  chatId: string | number,
  filePath: string,
  caption?: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const bunFile = Bun.file(filePath);
  if (!(await bunFile.exists())) {
    throw new Error(`File not found for MTProto upload: "${filePath}"`);
  }

  const fileName = basename(filePath);
  const sizeBytes = bunFile.size;

  const customFile = new CustomFile(fileName, sizeBytes, filePath);

  let targetEntity: any = chatId;
  if (String(chatId).toLowerCase() === 'me' || String(chatId).toLowerCase() === 'self') {
    targetEntity = 'me';
  } else if (!isNaN(Number(chatId))) {
    targetEntity = Number(chatId);
  }

  await client.sendFile(targetEntity, {
    file: customFile,
    caption,
    progressCallback: (percentage: number) => {
      if (onProgress) {
        onProgress(percentage);
      }
    },
  });
}

/**
 * Downloads a document attachment from a Telegram channel message via MTProto.
 *
 * @param client Connected TelegramClient instance
 * @param message Telegram message entity or ID
 * @param targetPath Destination file path on disk
 */
export async function downloadMTProtoFile(
  client: TelegramClient,
  message: unknown,
  targetPath: string
): Promise<void> {
  const buffer = await client.downloadMedia(message as any, {});
  if (buffer) {
    if (typeof buffer === 'string') {
      await Bun.write(targetPath, buffer);
    } else {
      await Bun.write(targetPath, new Uint8Array(buffer as unknown as ArrayLike<number>));
    }
  } else {
    throw new Error('Failed downloading document media via MTProto.');
  }
}

export interface MTProtoFileRecord {
  message: any;
  fileName: string;
  fileSize: number;
}

/**
 * Fetches recent messages containing file attachments from a Telegram entity via MTProto.
 *
 * @param client Connected TelegramClient instance
 * @param chatId Target channel, chat, user ID, or "me" for Saved Messages
 * @returns Array of MTProtoFileRecord file records
 */
export async function fetchMTProtoChannelFiles(
  client: TelegramClient,
  chatId: string | number
): Promise<MTProtoFileRecord[]> {
  let targetEntity: any = chatId;
  if (String(chatId).toLowerCase() === 'me' || String(chatId).toLowerCase() === 'self') {
    targetEntity = 'me';
  } else if (!isNaN(Number(chatId))) {
    targetEntity = Number(chatId);
  }

  const messages = await client.getMessages(targetEntity, { limit: 100 });
  const records: MTProtoFileRecord[] = [];

  for (const msg of messages) {
    if (msg && msg.media && 'document' in msg.media && msg.media.document) {
      const doc = msg.media.document as any;
      let fileName = 'unknown';
      if (doc.attributes) {
        for (const attr of doc.attributes) {
          if (attr.fileName) {
            fileName = attr.fileName;
            break;
          }
        }
      }
      records.push({
        message: msg,
        fileName,
        fileSize: Number(doc.size || 0),
      });
    }
  }

  return records;
}
