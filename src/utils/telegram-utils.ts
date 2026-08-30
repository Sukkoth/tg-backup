export interface TelegramDocumentResult {
  fileId: string;
  messageId: number;
}

export interface TelegramFileRecord {
  fileId: string;
  fileName: string;
  fileSize: number;
}

/**
 * Uploads a local file document to a Telegram chat/channel using sendDocument.
 *
 * @param token Telegram Bot Token
 * @param chatId Target chat ID or channel ID
 * @param filePath Absolute or relative path to file on disk
 * @param caption Optional message caption
 * @returns Object containing fileId and messageId
 */
export async function sendTelegramDocument(
  token: string,
  chatId: string,
  filePath: string,
  caption?: string
): Promise<TelegramDocumentResult> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new Error(`File not found for Telegram upload: "${filePath}"`);
  }

  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('document', file);
  if (caption) {
    formData.append('caption', caption);
  }

  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Telegram upload failed (${response.status}): ${errText}`);
  }

  const json = (await response.json()) as {
    ok: boolean;
    result?: {
      message_id: number;
      document?: { file_id: string };
    };
  };

  if (!json.ok || !json.result?.document?.file_id) {
    throw new Error('Telegram upload response missing file_id.');
  }

  return {
    fileId: json.result.document.file_id,
    messageId: json.result.message_id,
  };
}

/**
 * Downloads a file from Telegram servers using file_id via getFile.
 *
 * @param token Telegram Bot Token
 * @param fileId Telegram file_id identifier
 * @param targetPath Path where downloaded bytes will be saved
 */
export async function downloadTelegramFile(
  token: string,
  fileId: string,
  targetPath: string
): Promise<void> {
  const getFileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`;
  const response = await fetch(getFileUrl);

  if (!response.ok) {
    throw new Error(`Telegram getFile request failed: ${await response.text()}`);
  }

  const json = (await response.json()) as {
    ok: boolean;
    result?: { file_path: string };
  };

  if (!json.ok || !json.result?.file_path) {
    throw new Error(`Telegram getFile returned invalid file_path for file_id "${fileId}".`);
  }

  const downloadUrl = `https://api.telegram.org/file/bot${token}/${json.result.file_path}`;
  const fileResponse = await fetch(downloadUrl);

  if (!fileResponse.ok) {
    throw new Error(`Failed downloading Telegram file payload: ${await fileResponse.text()}`);
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  await Bun.write(targetPath, new Uint8Array(arrayBuffer));
}

/**
 * Fetches recent channel updates/messages to locate chunk archives and manifest.json.gz.
 *
 * @param token Telegram Bot Token
 * @param chatId Target chat ID or channel ID
 * @returns Array of uploaded file records found in Telegram chat
 */
export async function fetchTelegramChannelFiles(
  token: string,
  chatId: string
): Promise<TelegramFileRecord[]> {
  const updatesUrl = `https://api.telegram.org/bot${token}/getUpdates`;
  const response = await fetch(updatesUrl);

  if (!response.ok) {
    throw new Error(`Telegram getUpdates failed: ${await response.text()}`);
  }

  const json = (await response.json()) as {
    ok: boolean;
    result?: Array<{
      channel_post?: {
        chat: { id: number | string };
        document?: { file_id: string; file_name?: string; file_size?: number };
      };
      message?: {
        chat: { id: number | string };
        document?: { file_id: string; file_name?: string; file_size?: number };
      };
    }>;
  };

  if (!json.ok || !json.result) {
    return [];
  }

  const files: TelegramFileRecord[] = [];

  for (const item of json.result) {
    const post = item.channel_post ?? item.message;
    if (post && String(post.chat.id) === String(chatId) && post.document?.file_id) {
      files.push({
        fileId: post.document.file_id,
        fileName: post.document.file_name ?? 'unknown',
        fileSize: post.document.file_size ?? 0,
      });
    }
  }

  return files;
}
