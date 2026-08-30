import type { ProviderUploadOptions } from './providers/provider-interface.ts';
import { TelegramStorageProvider } from './providers/telegram-provider.ts';

export interface UploadCommandOptions extends ProviderUploadOptions {
  provider: string;
}

/**
 * Dispatches backup chunk folder upload to the specified cloud storage provider.
 *
 * @param options Upload command parameters
 */
export async function uploadBackup(options: UploadCommandOptions): Promise<void> {
  const providerName = options.provider.toLowerCase();

  if (providerName === 'telegram' || providerName === 'tg') {
    const provider = new TelegramStorageProvider();
    await provider.uploadBackup(options);
  } else {
    throw new Error(
      `Unsupported cloud storage provider: "${options.provider}". Supported providers: telegram.`
    );
  }
}
