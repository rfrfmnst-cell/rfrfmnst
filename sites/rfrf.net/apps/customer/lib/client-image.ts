export const CUSTOMER_IMAGE_MAX_EDGE = 1600;
export const CUSTOMER_IMAGE_MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const INPUT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Rebuild JPEG segments, dropping all application metadata and comments. */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('IMAGE_ENCODING_FAILED');
  }
  const chunks = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 0xff) throw new Error('IMAGE_ENCODING_FAILED');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      chunks.push(bytes.subarray(start, offset));
      const result = new Uint8Array(
        chunks.reduce((size, chunk) => size + chunk.length, 0),
      );
      let position = 0;
      for (const chunk of chunks) {
        result.set(chunk, position);
        position += chunk.length;
      }
      return result;
    }
    if (marker === undefined || marker === 0 || marker === 0xd8) {
      throw new Error('IMAGE_ENCODING_FAILED');
    }
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) {
      throw new Error('IMAGE_ENCODING_FAILED');
    }
    offset += length;
    if (!((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe)) {
      chunks.push(bytes.subarray(start, offset));
    }
    if (marker === 0xda) {
      const scanStart = offset;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        const next = bytes[offset + 1];
        if (
          next === 0 ||
          (next !== undefined && next >= 0xd0 && next <= 0xd7)
        ) {
          offset += 2;
          continue;
        }
        break;
      }
      chunks.push(bytes.subarray(scanStart, offset));
    }
  }
  throw new Error('IMAGE_ENCODING_FAILED');
}

async function decodeImage(file: File) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap as CanvasImageSource,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      source: image as CanvasImageSource,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** Only a newly encoded, resized image can leave the browser. */
export async function prepareCustomerImage(file: File): Promise<File> {
  if (
    !INPUT_TYPES.has(file.type) ||
    file.size <= 0 ||
    file.size > CUSTOMER_IMAGE_MAX_INPUT_BYTES
  ) {
    throw new Error('IMAGE_INPUT_INVALID');
  }
  const decoded = await decodeImage(file);
  const canvas = document.createElement('canvas');
  try {
    if (
      !decoded.width ||
      !decoded.height ||
      decoded.width * decoded.height > 60_000_000
    ) {
      throw new Error('IMAGE_INPUT_INVALID');
    }
    const scale = Math.min(
      1,
      CUSTOMER_IMAGE_MAX_EDGE / Math.max(decoded.width, decoded.height),
    );
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('IMAGE_ENCODING_FAILED');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    const encoded = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob?.type === 'image/jpeg'
            ? resolve(blob)
            : reject(new Error('IMAGE_ENCODING_FAILED')),
        'image/jpeg',
        0.88,
      );
    });
    const bytes = stripJpegMetadata(
      new Uint8Array(await encoded.arrayBuffer()),
    );
    if (!bytes.length || bytes.length > MAX_OUTPUT_BYTES) {
      throw new Error('IMAGE_ENCODING_FAILED');
    }
    // Use a generated name: the source filename can also contain private data.
    return new File([bytes], 'rafraf-image.jpg', { type: 'image/jpeg' });
  } finally {
    decoded.dispose();
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function customerImageDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}
