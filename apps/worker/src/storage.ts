import { createHash } from 'node:crypto';

/**
 * Artifacts are content-addressed. Small ones live inline in Postgres; large
 * ones (diffs, transcripts) belong in object storage, with the row keeping
 * only a pointer (docs/04: content OR storage_ref, never both).
 */
export interface ArtifactStorage {
  readonly kind: 'inline' | 's3';
  /** Returns a storage reference, or null when the payload should stay inline. */
  put(key: string, body: string): Promise<string | null>;
  get(ref: string): Promise<string | null>;
}

/** Everything inline — the single-node default. */
export class InlineArtifactStorage implements ArtifactStorage {
  readonly kind = 'inline' as const;
  async put(): Promise<string | null> {
    return null;
  }
  async get(): Promise<string | null> {
    return null;
  }
}

/**
 * S3-compatible storage (AWS, MinIO, R2) over the REST API with SigV4. Only
 * payloads above the threshold are offloaded, so small artifacts stay
 * queryable in SQL.
 */
export class S3ArtifactStorage implements ArtifactStorage {
  readonly kind = 's3' as const;

  constructor(
    private readonly config: {
      bucket: string;
      region: string;
      endpoint?: string;
      accessKeyId: string;
      secretAccessKey: string;
      inlineThresholdBytes?: number;
    },
  ) {}

  private get threshold(): number {
    return this.config.inlineThresholdBytes ?? 64 * 1024;
  }

  private url(key: string): string {
    const base =
      this.config.endpoint ?? `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com`;
    return this.config.endpoint
      ? `${base.replace(/\/$/, '')}/${this.config.bucket}/${key}`
      : `${base}/${key}`;
  }

  async put(key: string, body: string): Promise<string | null> {
    if (Buffer.byteLength(body, 'utf8') < this.threshold) return null;
    const url = this.url(key);
    const response = await fetch(url, {
      method: 'PUT',
      headers: await this.signedHeaders('PUT', url, body),
      body,
    });
    if (!response.ok) {
      throw new Error(`artifact upload failed (${response.status}): ${await response.text()}`);
    }
    return url;
  }

  async get(ref: string): Promise<string | null> {
    const response = await fetch(ref, { headers: await this.signedHeaders('GET', ref, '') });
    if (!response.ok) return null;
    return response.text();
  }

  /**
   * Minimal SigV4. Written out rather than pulling in the AWS SDK: the signing
   * surface we need is one request shape, and the dependency is large.
   */
  private async signedHeaders(
    method: string,
    url: string,
    body: string,
  ): Promise<Record<string, string>> {
    const { createHmac } = await import('node:crypto');
    const parsed = new URL(url);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash('sha256').update(body).digest('hex');

    const canonicalHeaders = `host:${parsed.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [
      method,
      parsed.pathname,
      parsed.searchParams.toString(),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const hmac = (key: Buffer | string, data: string): Buffer =>
      createHmac('sha256', key).update(data).digest();
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.config.secretAccessKey}`, dateStamp), this.config.region), 's3'),
      'aws4_request',
    );
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    return {
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }
}

export function storageFromEnv(): ArtifactStorage {
  const bucket = process.env.S3_BUCKET;
  if (!bucket || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
    return new InlineArtifactStorage();
  }
  return new S3ArtifactStorage({
    bucket,
    region: process.env.S3_REGION ?? 'us-east-1',
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    ...(process.env.S3_INLINE_THRESHOLD_BYTES
      ? { inlineThresholdBytes: Number(process.env.S3_INLINE_THRESHOLD_BYTES) }
      : {}),
  });
}
