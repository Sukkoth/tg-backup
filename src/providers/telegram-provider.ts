import { readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  StorageProvider,
  ProviderUploadOptions,
  ProviderDownloadOptions,
} from './provider-interface.ts';
import {
  sendTelegramDocument,
  downloadTelegramFile,
  fetchTelegramChannelFiles,
} from '../utils/telegram-utils.ts';
import {
  createMTProtoClient,
  uploadMTProtoFile,
  downloadMTProtoFile,
  fetchMTProtoChannelFiles,
} from '../utils/mtproto-utils.ts';
import { formatBytes } from '../utils/size-utils.ts';
import { ProgressBar } from '../utils/progress-utils.ts';

export class TelegramStorageProvider implements StorageProvider {
  public name = 'telegram';

  /**
   * Uploads local chunk archives in chunkDir to Telegram.
   */
  public async uploadBackup(options: ProviderUploadOptions): Promise<void> {
    const {
      chunkDir,
      telegramToken,
      telegramChatId,
      apiId,
      apiHash,
      session,
      progress = true,
    } = options;

    if (!telegramChatId) {
      throw new Error('Telegram upload requires target chat/channel ID (--telegram-chat-id).');
    }

    const dirFiles = await readdir(chunkDir);
    const chunkFiles = dirFiles.filter((f) => f.endsWith('.tar.gz') || f.endsWith('.tar')).sort();
    const manifestFile = dirFiles.find((f) => f.includes('manifest.json'));

    if (chunkFiles.length === 0 && !manifestFile) {
      throw new Error(`No backup chunk files or manifest found in "${chunkDir}".`);
    }

    const allFilesToUpload = [...chunkFiles];
    if (manifestFile) {
      allFilesToUpload.push(manifestFile);
    }

    console.log(
      `[INFO] Preparing to upload ${allFilesToUpload.length} files to Telegram (${telegramChatId})...`
    );

    const progressBar = new ProgressBar('Uploading to Telegram', allFilesToUpload.length, progress);

    if (apiId && apiHash) {
      console.log(`[INFO] Connecting via MTProto (2GB/4GB upload mode)...`);
      const { client } = await createMTProtoClient(apiId, apiHash, session);

      try {
        for (let i = 0; i < allFilesToUpload.length; i++) {
          const fileName = allFilesToUpload[i]!;
          const filePath = join(chunkDir, fileName);
          const fileObj = Bun.file(filePath);
          const caption = `Backup File: ${fileName} | Size: ${formatBytes(fileObj.size)}`;

          await uploadMTProtoFile(client, telegramChatId, filePath, caption);
          progressBar.update(i + 1);
        }
      } finally {
        try {
          await client.disconnect();
          await client.destroy();
        } catch {}
      }
    } else if (telegramToken) {
      console.log(`[INFO] Connecting via Telegram Bot API (50MB upload mode)...`);
      for (let i = 0; i < allFilesToUpload.length; i++) {
        const fileName = allFilesToUpload[i]!;
        const filePath = join(chunkDir, fileName);
        const fileObj = Bun.file(filePath);
        const caption = `Backup File: ${fileName} | Size: ${formatBytes(fileObj.size)}`;

        await sendTelegramDocument(telegramToken, telegramChatId, filePath, caption);
        progressBar.update(i + 1);
      }
    } else {
      throw new Error(
        'Telegram upload requires either --telegram-token or (--api-id and --api-hash).'
      );
    }

    progressBar.finish();
    console.log(
      `[SUCCESS] All ${allFilesToUpload.length} files uploaded to Telegram successfully!`
    );
  }

  /**
   * Downloads chunk archives from Telegram to targetDir.
   */
  public async downloadBackup(options: ProviderDownloadOptions): Promise<void> {
    const {
      targetDir,
      telegramToken,
      telegramChatId,
      apiId,
      apiHash,
      session,
      progress = true,
      prefix,
      listBackups,
    } = options;

    if (!telegramChatId) {
      throw new Error('Telegram download requires chat/channel ID (--telegram-chat-id).');
    }

    if (telegramToken) {
      console.log(`[INFO] Connecting to Telegram channel (${telegramChatId}) via Bot API...`);
      const tgFiles = await fetchTelegramChannelFiles(telegramToken, telegramChatId);

      if (tgFiles.length === 0) {
        throw new Error(`No backup files found in Telegram channel (${telegramChatId}).`);
      }

      if (listBackups) {
        const manifestFiles = tgFiles.filter((f) => f.fileName.includes('manifest.json'));
        const prefixes = new Set<string>();

        for (const mf of manifestFiles) {
          const p = mf.fileName.replace(/manifest\.json(\.gz)?$/, '');
          prefixes.add(p || 'chunk_');
        }

        for (const f of tgFiles) {
          const match = f.fileName.match(/^([a-zA-Z0-9_-]+_)\d{3}\.tar(\.gz)?$/);
          if (match && match[1]) {
            prefixes.add(match[1]);
          }
        }

        console.log('\n--------------------------------------------------');
        console.log(`[INFO] Found ${prefixes.size} distinct backup set(s) in Telegram channel:`);
        let idx = 1;
        for (const p of prefixes) {
          const matchingFiles = tgFiles.filter((f) => f.fileName.startsWith(p));
          const totalSize = matchingFiles.reduce((acc, f) => acc + f.fileSize, 0);
          console.log(
            `  ${idx++}. Prefix: "${p}" | Files: ${matchingFiles.length} | Size: ${formatBytes(totalSize)}`
          );
        }
        console.log('--------------------------------------------------');
        console.log('To download a specific backup set, run:');
        console.log(
          `  bun start download -o ./output --provider telegram --prefix <prefix_name>\n`
        );
        return;
      }

      let filesToDownload = tgFiles;
      if (prefix) {
        filesToDownload = tgFiles.filter((f) => f.fileName.startsWith(prefix));
        if (filesToDownload.length === 0) {
          throw new Error(
            `No backup files matching prefix "${prefix}" found in Telegram channel (${telegramChatId}).`
          );
        }
      }

      await mkdir(targetDir, { recursive: true });
      console.log(
        `[INFO] Downloading ${filesToDownload.length} files matching prefix "${prefix ?? 'ALL'}" to "${targetDir}"...`
      );
      const progressBar = new ProgressBar(
        'Downloading from Telegram',
        filesToDownload.length,
        progress
      );

      for (let i = 0; i < filesToDownload.length; i++) {
        const tgFile = filesToDownload[i]!;
        const targetPath = join(targetDir, tgFile.fileName);

        await downloadTelegramFile(telegramToken, tgFile.fileId, targetPath);
        progressBar.update(i + 1);
      }

      progressBar.finish();
      console.log(
        `[SUCCESS] Downloaded ${filesToDownload.length} backup files from Telegram into "${targetDir}".`
      );
    } else if (apiId && apiHash) {
      console.log(`[INFO] Connecting via MTProto (2GB/4GB download mode)...`);
      const { client } = await createMTProtoClient(apiId, apiHash, session);

      try {
        const tgFiles = await fetchMTProtoChannelFiles(client, telegramChatId);

        if (tgFiles.length === 0) {
          throw new Error(`No backup files found in Telegram chat/channel (${telegramChatId}).`);
        }

        if (listBackups) {
          const manifestFiles = tgFiles.filter((f) => f.fileName.includes('manifest.json'));
          const prefixes = new Set<string>();

          for (const mf of manifestFiles) {
            const p = mf.fileName.replace(/manifest\.json(\.gz)?$/, '');
            prefixes.add(p || 'chunk_');
          }

          for (const f of tgFiles) {
            const match = f.fileName.match(/^([a-zA-Z0-9_-]+_)\d{3}\.tar(\.gz)?$/);
            if (match && match[1]) {
              prefixes.add(match[1]);
            }
          }

          console.log('\n--------------------------------------------------');
          console.log(`[INFO] Found ${prefixes.size} distinct backup set(s) in Telegram:`);
          let idx = 1;
          for (const p of prefixes) {
            const matchingFiles = tgFiles.filter((f) => f.fileName.startsWith(p));
            const totalSize = matchingFiles.reduce((acc, f) => acc + f.fileSize, 0);
            console.log(
              `  ${idx++}. Prefix: "${p}" | Files: ${matchingFiles.length} | Size: ${formatBytes(totalSize)}`
            );
          }
          console.log('--------------------------------------------------');
          console.log('To download a specific backup set, run:');
          console.log(`  bun start download -o ./output --provider telegram --prefix <prefix_name>\n`);
          return;
        }

        let filesToDownload = tgFiles;
        if (prefix) {
          filesToDownload = tgFiles.filter((f) => f.fileName.startsWith(prefix));
          if (filesToDownload.length === 0) {
            throw new Error(
              `No backup files matching prefix "${prefix}" found in Telegram chat (${telegramChatId}).`
            );
          }
        }

        await mkdir(targetDir, { recursive: true });
        console.log(
          `[INFO] Downloading ${filesToDownload.length} files matching prefix "${prefix ?? 'ALL'}" to "${targetDir}"...`
        );
        const progressBar = new ProgressBar('Downloading via MTProto', filesToDownload.length, progress);

        for (let i = 0; i < filesToDownload.length; i++) {
          const tgFile = filesToDownload[i]!;
          const targetPath = join(targetDir, tgFile.fileName);

          await downloadMTProtoFile(client, tgFile.message, targetPath);
          progressBar.update(i + 1);
        }

        progressBar.finish();
        console.log(
          `[SUCCESS] Downloaded ${filesToDownload.length} backup files from Telegram into "${targetDir}".`
        );
      } finally {
        try {
          await client.disconnect();
          await client.destroy();
        } catch {}
      }
    } else {
      throw new Error(
        'Telegram download requires either --telegram-token or (--api-id and --api-hash).'
      );
    }
  }
}
