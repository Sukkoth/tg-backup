export interface ProviderUploadOptions {
  chunkDir: string;
  telegramToken?: string;
  telegramChatId?: string;
  apiId?: number;
  apiHash?: string;
  session?: string;
  progress?: boolean;
}

export interface ProviderDownloadOptions {
  targetDir: string;
  telegramToken?: string;
  telegramChatId?: string;
  apiId?: number;
  apiHash?: string;
  session?: string;
  progress?: boolean;
  prefix?: string;
  backupId?: string;
  listBackups?: boolean;
}

/**
 * Interface definition for all cloud storage provider plugins.
 */
export interface StorageProvider {
  name: string;
  uploadBackup(options: ProviderUploadOptions): Promise<void>;
  downloadBackup(options: ProviderDownloadOptions): Promise<void>;
}
