/*
 * Copyright 2026 The backstage-plugin-temporal Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import type { Config } from '@backstage/config';
import {
  AwsS3Integration,
  type AwsS3IntegrationConfig,
} from '@backstage/integration';
import {
  type AwsCredentialProvider,
  type AwsCredentialsManager,
  DefaultAwsCredentialsManager,
} from '@backstage/integration-aws-node';

/**
 * Host of the AWS S3 entry of `integrations.awsS3`. Backstage adds this
 * entry, with the default AWS credentials, when the config has none.
 */
export const AWS_S3_HOST = 'amazonaws.com';
/** Region of the bucket when `region` is not set, as in Backstage. */
const DEFAULT_REGION = 'us-east-1';
/** Session name of the role sessions the backend starts. */
const ROLE_SESSION_NAME = 'backstage-plugin-temporal';

/**
 * Keys of `temporal.externalStorage.s3` whose settings belong to
 * `integrations.awsS3`, with the keys they correspond to there.
 */
const INTEGRATION_KEYS: Record<string, string> = {
  endpoint: 'endpoint',
  forcePathStyle: 's3ForcePathStyle',
  credentials: 'accessKeyId and secretAccessKey (or roleArn)',
};

type CredentialProvider = AwsCredentialProvider['sdkCredentialProvider'];

/**
 * The credentials of an `integrations.awsS3` entry, chosen as Backstage's
 * S3 URL reader does: its access key, a role assumed with that key or with
 * the main AWS account (`aws.mainAccount`, by default the AWS SDK's
 * default credential chain), or the main account itself.
 */
export async function integrationCredentials(
  integration: AwsS3IntegrationConfig,
  region: string,
  credentialsManager: AwsCredentialsManager,
): Promise<CredentialProvider> {
  const { accessKeyId, secretAccessKey, roleArn, externalId } = integration;
  const assumeRole = (masterCredentials: CredentialProvider) =>
    fromTemporaryCredentials({
      masterCredentials,
      params: {
        RoleSessionName: ROLE_SESSION_NAME,
        RoleArn: roleArn!,
        ExternalId: externalId,
      },
      clientConfig: { region },
    });
  if (accessKeyId && secretAccessKey) {
    const accessKey = async () => ({ accessKeyId, secretAccessKey });
    return roleArn ? assumeRole(accessKey) : accessKey;
  }
  if (roleArn) {
    const master = await credentialsManager
      .getCredentialProvider({ arn: roleArn })
      .catch(() => credentialsManager.getCredentialProvider());
    return assumeRole(master.sdkCredentialProvider);
  }
  return (await credentialsManager.getCredentialProvider())
    .sdkCredentialProvider;
}

/**
 * An S3 client with the endpoint, path style and credentials of an
 * `integrations.awsS3` entry. The credentials are looked up on the first
 * request.
 */
export function createS3Client(options: {
  integration: AwsS3IntegrationConfig;
  region: string;
  credentialsManager: AwsCredentialsManager;
}): S3Client {
  const { integration, region, credentialsManager } = options;
  let provider: Promise<CredentialProvider> | undefined;
  const credentials = async () => {
    provider ??= integrationCredentials(
      integration,
      region,
      credentialsManager,
    ).catch(error => {
      provider = undefined;
      throw error;
    });
    return (await provider)();
  };
  return new S3Client({
    region,
    endpoint: integration.endpoint,
    forcePathStyle: integration.s3ForcePathStyle ?? false,
    credentials,
    // Checksums are only sent when the operation requires them, which
    // more S3-compatible services understand.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/** The bucket of External Storage and the client that reads it. */
export interface S3PayloadReaderOptions {
  /** Bucket of the payloads, the same as the workers use. */
  bucket: string;
  /** S3 client with read access to the bucket. */
  client: Pick<S3Client, 'send'>;
}

/**
 * Reads payload data from one bucket of S3 or an S3-compatible service.
 * The backend only reads; the workers write.
 */
export class S3PayloadReader {
  readonly bucket: string;
  private readonly client: Pick<S3Client, 'send'>;

  constructor(options: S3PayloadReaderOptions) {
    if (!options.bucket) throw new TypeError('S3 bucket is required');
    this.bucket = options.bucket;
    this.client = options.client;
  }

  /**
   * Reads `temporal.externalStorage.s3` (`s3`) and the `integrations.awsS3`
   * entry whose host is its `integrationHost` (default `amazonaws.com`).
   * The connection and the credentials come from that entry.
   */
  static fromConfig(
    config: Config,
    s3: Config,
    credentialsManager: AwsCredentialsManager = DefaultAwsCredentialsManager.fromConfig(
      config,
    ),
  ): S3PayloadReader {
    const moved = Object.keys(INTEGRATION_KEYS).filter(key => s3.has(key));
    if (moved.length > 0) {
      const keys = moved.map(key => `temporal.externalStorage.s3.${key}`);
      const targets = moved.map(key => INTEGRATION_KEYS[key]);
      throw new Error(
        `Unsupported config ${keys.join(
          ', ',
        )}: the S3 connection and credentials of External Storage come from integrations.awsS3. ` +
          `Set ${targets.join(
            '; ',
          )} in an entry of integrations.awsS3, and temporal.externalStorage.s3.integrationHost to the host of its endpoint (leave it out for AWS S3)`,
      );
    }
    const host = s3.getOptionalString('integrationHost') ?? AWS_S3_HOST;
    const integrations = AwsS3Integration.factory({ config });
    const integration = integrations.byHost(host);
    if (!integration) {
      const hosts = integrations.list().map(i => i.config.host);
      throw new Error(
        `temporal.externalStorage.s3.integrationHost is ${host}, but no entry of integrations.awsS3 has this host (the host and port of its endpoint, for example localhost:9000 for http://localhost:9000). Hosts: ${hosts.join(
          ', ',
        )}`,
      );
    }
    return new S3PayloadReader({
      bucket: s3.getString('bucket'),
      client: createS3Client({
        integration: integration.config,
        region: s3.getOptionalString('region') ?? DEFAULT_REGION,
        credentialsManager,
      }),
    });
  }

  /**
   * Reads the whole object. With `maxBytes`, an object larger than that is
   * refused, whatever size its reference claims: at most `maxBytes + 1`
   * bytes are asked for.
   */
  async get(key: string, maxBytes?: number): Promise<Uint8Array> {
    const limited = maxBytes !== undefined;
    const response = await this.client
      .send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(limited ? { Range: `bytes=0-${maxBytes}` } : {}),
        }),
      )
      .catch(error => {
        // A range from byte 0 is only unsatisfiable for an empty object.
        if (limited && isInvalidRange(error)) return undefined;
        throw error;
      });
    if (!response) return new Uint8Array();
    if (!response.Body) throw new Error(`S3 object ${key} has no body`);
    const tooLarge = () =>
      new Error(`S3 object ${key} is larger than ${maxBytes} bytes`);
    // The whole size: after the slash of `Content-Range`, or the length
    // when the service sent the whole object.
    const total = response.ContentRange
      ? Number(response.ContentRange.split('/')[1])
      : response.ContentLength;
    if (limited && total !== undefined && total > maxBytes) {
      // Not read: closes the connection of the response.
      (response.Body as { destroy?: () => void }).destroy?.();
      throw tooLarge();
    }
    const data = await response.Body.transformToByteArray();
    if (limited && data.length > maxBytes) throw tooLarge();
    return data;
  }
}

/** S3's answer (416) to a range that the object does not have. */
function isInvalidRange(error: unknown): boolean {
  const e = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return e?.name === 'InvalidRange' || e?.$metadata?.httpStatusCode === 416;
}
