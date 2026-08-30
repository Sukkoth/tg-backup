import type { ProviderDownloadOptions } from './providers/provider-interface.ts';
import { TelegramStorageProvider } from './providers/telegram-provider.ts';

export interface DownloadCommandOptions extends ProviderDownloadOptions {
  provider: string;
}

/**
 * Dispatches backup chunk folder download from the specified cloud storage provider.
 *
 * @param options Download command parameters
 */
export async function downloadBackup(options: DownloadCommandOptions): Promise<void> {
  const providerName = options.provider.toLowerCase();

  if (providerName === 'telegram' || providerName === 'tg') {
    const provider = new TelegramStorageProvider();
    await provider.downloadBackup(options);
  } else {
    throw new Error(
      `Unsupported cloud storage provider: "${options.provider}". Supported providers: telegram.`
    );
  }
}
