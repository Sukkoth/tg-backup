import { formatBytes } from './size-utils.ts';

/**
 * Visual progress bar and speed stats formatter for TTY terminal output.
 */
export class ProgressBar {
  private total: number;
  private current: number = 0;
  private startTime: number = Date.now();
  private title: string;
  private enabled: boolean;

  constructor(title: string, total: number, enabled: boolean = true) {
    this.title = title;
    this.total = total;
    this.enabled = enabled;
  }

  /**
   * Updates the progress bar with current progress count and optional processed byte count.
   *
   * @param current Current item count
   * @param bytesProcessed Cumulative bytes processed
   */
  public update(current: number, bytesProcessed?: number): void {
    this.current = current;
    if (!this.enabled || !process.stdout.isTTY) return;

    const percent = Math.min(100, Math.floor((this.current / (this.total || 1)) * 100));
    const barWidth = 20;
    const filled = Math.floor((percent / 100) * barWidth);
    const empty = barWidth - filled;
    const bar = '='.repeat(filled) + (empty > 0 ? '>' : '') + ' '.repeat(Math.max(0, empty - 1));

    const elapsedSec = (Date.now() - this.startTime) / 1000;
    let speedStr = '';
    if (bytesProcessed && elapsedSec > 0) {
      speedStr = ` | ${formatBytes(bytesProcessed / elapsedSec)}/s`;
    }

    process.stdout.write(
      `\r[INFO] ${this.title} [${bar}] ${percent}% (${this.current}/${this.total}${speedStr})`
    );
  }

  /**
   * Clears the active progress bar line upon step completion.
   */
  public finish(): void {
    if (this.enabled && process.stdout.isTTY) {
      process.stdout.write('\r\x1b[K');
    }
  }
}
