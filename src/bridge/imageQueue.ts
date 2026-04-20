import { ImageRawDataUpdateResult } from '@evenrealities/even_hub_sdk';

export type ImageUpdateRequest = {
  containerID: number;
  containerName: string;
  imageData: Uint8Array;
};

type ImageUpdater = (request: ImageUpdateRequest) => Promise<ImageRawDataUpdateResult | -1>;

type Logger = (message: string) => void;

export class SerializedImageQueue {
  private queue: Promise<void> = Promise.resolve();
  private readonly updateImage: ImageUpdater;
  private readonly log: Logger;

  constructor(options: { updateImage: ImageUpdater; log: Logger }) {
    this.updateImage = options.updateImage;
    this.log = options.log;
  }

  enqueue(update: ImageUpdateRequest) {
    const task = this.queue
      .then(async () => {
        const result = await this.updateImage(update);
        if (result !== ImageRawDataUpdateResult.success) {
          this.log(`Image update failed (${update.containerName}): ${String(result)}`);
          return false;
        }

        return true;
      })
      .catch((error) => {
        this.log(`Image queue error: ${String(error)}`);
        return false;
      });

    this.queue = task.then(() => undefined);
    return task;
  }

  reset() {
    this.queue = Promise.resolve();
  }
}
