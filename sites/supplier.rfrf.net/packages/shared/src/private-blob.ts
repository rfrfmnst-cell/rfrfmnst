export interface PrivateBlobGetResult {
  statusCode: number;
  stream: ReadableStream<Uint8Array> | null;
}

export interface PrivateBlobCredentialInput {
  token?: string;
  oidcToken?: string;
  storeId?: string;
}

interface PrivateBlobCredentialOptions {
  token?: string;
  oidcToken?: string;
  storeId?: string;
}

export interface PrivateBlobClient {
  put?: (
    pathname: string,
    bytes: Uint8Array,
    options: PrivateBlobCredentialOptions & {
      access: 'private';
      addRandomSuffix: false;
      allowOverwrite: false;
      contentType: string;
    },
  ) => Promise<unknown>;
  get?: (
    pathname: string,
    options: PrivateBlobCredentialOptions & {
      access: 'private';
      useCache: false;
    },
  ) => Promise<PrivateBlobGetResult | null>;
  del?: (
    pathname: string,
    options: PrivateBlobCredentialOptions,
  ) => Promise<unknown>;
  list?: (
    options: {
      limit: 1;
      prefix: string;
    } & PrivateBlobCredentialOptions,
  ) => Promise<unknown>;
}

export function createPrivateBlobAdapter(
  client: PrivateBlobClient,
  credentialInput: string | PrivateBlobCredentialInput | undefined,
) {
  const input =
    typeof credentialInput === 'string'
      ? { token: credentialInput }
      : credentialInput;
  const token = input?.token?.trim();
  const oidcToken = input?.oidcToken?.trim();
  const storeId = input?.storeId?.trim();
  if (!token && !(oidcToken && storeId)) {
    throw new Error('Private Blob storage is not configured');
  }
  const credentials: PrivateBlobCredentialOptions = token
    ? { token }
    : { oidcToken, storeId };

  return {
    async put(
      pathname: string,
      bytes: Uint8Array,
      contentType: string,
    ): Promise<void> {
      if (!client.put) throw new Error('Private Blob upload is unavailable');
      await client.put(pathname, bytes, {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType,
        ...credentials,
      });
    },

    async get(pathname: string): Promise<Uint8Array> {
      if (!client.get) throw new Error('Private Blob download is unavailable');
      const result = await client.get(pathname, {
        access: 'private',
        ...credentials,
        useCache: false,
      });
      if (!result || result.statusCode !== 200 || !result.stream) {
        throw new Error('Private blob not found');
      }
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },

    async delete(pathname: string): Promise<void> {
      if (!client.del) throw new Error('Private Blob delete is unavailable');
      await client.del(pathname, credentials);
    },

    async ready(prefix: string): Promise<boolean> {
      if (!client.list) return false;
      try {
        await client.list({ limit: 1, prefix, ...credentials });
        return true;
      } catch {
        return false;
      }
    },
  };
}
