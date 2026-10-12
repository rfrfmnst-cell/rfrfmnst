import {
  customerImageDataUrl,
  prepareCustomerImage,
} from '../../lib/client-image';

export async function compressPreviewImage(file: File): Promise<string> {
  return customerImageDataUrl(await prepareCustomerImage(file));
}
