import { ImageRawDataUpdateResult } from '@evenrealities/even_hub_sdk';

export type ImageUpdateRequest = {
  containerID: number;
  containerName: string;
  imageData: Uint8Array;
};

type ImageUpdater = (request: ImageUpdateRequest) => Promise<ImageRawDataUpdateResult | -1>;

type Logger = (message: string) => void;

export class SerializedImageQueue {
  private queue = Promise.resolve();
  private readonly updateImage: ImageUpdater;
  private readonly log: Logger;

  constructor(options: { updateImage: ImageUpdater; log: Logger }) {
    this.updateImage = options.updateImage;
    this.log = options.log;
  }

  enqueue(update: ImageUpdateRequest) {
    this.queue = this.queue
      .then(async () => {
        const result = await this.updateImage(update);
        if (result !== ImageRawDataUpdateResult.success) {
          this.log(`Image update failed (${update.containerName}): ${String(result)}`);
        }
      })
      .catch((error) => {
        this.log(`Image queue error: ${String(error)}`);
      });

    return this.queue;
  }

  reset() {
    this.queue = Promise.resolve();
  }
}
