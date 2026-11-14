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
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';
import {
  type AwsCredentialProvider,
  type AwsCredentialsManager,
  DefaultAwsCredentialsManager,
} from '@backstage/integration-aws-node';
import { StorageIntegrityError } from './storageReference';

/** Region of the bucket when `region` is not set. */
const DEFAULT_REGION = 'us-east-1';
const KEY = 'temporal.externalStorage.s3';

type CredentialProvider = AwsCredentialProvider['sdkCredentialProvider'];

/**
 * Where the backend's S3 credentials come from: exactly one of
 * `credentials` (an access key of the plugin), `accountId` (an account of
 * Backstage's `aws` config) and `defaultCredentials` (the AWS SDK's default
 * credential chain).
 */
export type S3CredentialSource =
  | {
      type: 'accessKey';
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
    }
  | { type: 'account'; accountId: string }
  | { type: 'default' };

/** Reads the credential source of `temporal.externalStorage.s3`. */
export function readCredentialSource(s3: Config): S3CredentialSource {
  const credentials = s3.getOptionalConfig('credentials');
  const accountId = s3.getOptionalString('accountId');
  const defaultCredentials = s3.getOptionalBoolean('defaultCredentials');
  const set = [
    credentials && 'credentials',
    accountId !== undefined && 'accountId',
    defaultCredentials && 'defaultCredentials',
  ].filter(Boolean);
  if (set.length !== 1) {
    throw new Error(
      `${KEY} needs exactly one source of S3 credentials, ${
        set.length === 0 ? 'and has none' : `and has ${set.join(', ')}`
      }: credentials (an access key with accessKeyId and secretAccessKey), accountId (an account of aws.accounts) or defaultCredentials: true (the AWS SDK's default credential chain)`,
    );
  }
  if (credentials) {
    return {
      type: 'accessKey',
      accessKeyId: credentials.getString('accessKeyId'),
      secretAccessKey: credentials.getString('secretAccessKey'),
      sessionToken: credentials.getOptionalString('sessionToken'),
    };
  }
  if (accountId !== undefined) {
    if (!/^\d{12}$/.test(accountId)) {
      throw new Error(
        `${KEY}.accountId must be an AWS account ID of 12 digits`,
      );
    }
    return { type: 'account', accountId };
  }
  return { type: 'default' };
}

/**
 * Why an account of `accountId` may also be used by Backstage's S3 URL
 * reader, which reads with the main AWS account and with the accounts of
 * the `roleArn` of `integrations.awsS3`; undefined when it is not.
 */
export function sharedAccountWarning(
  config: Config,
  accountId: string,
): string | undefined {
  const accounts = config.getOptionalConfigArray('aws.accounts') ?? [];
  const listed = accounts.some(
    a => a.getOptionalString('accountId') === accountId,
  );
  const roleDefaults = config.getOptionalString('aws.accountDefaults.roleName');
  if (!listed && !roleDefaults) {
    return `${KEY}.accountId ${accountId} is not in aws.accounts, so it can only be the main AWS account (aws.mainAccount), whose credentials Backstage's URL reader also uses. Add an entry for the account to aws.accounts`;
  }
  const integrations =
    config.getOptionalConfigArray('integrations.awsS3') ?? [];
  const shared = integrations.some(
    i => i.getOptionalString('roleArn')?.split(':')[4] === accountId,
  );
  if (shared) {
    return `${KEY}.accountId ${accountId} is the account of a roleArn in integrations.awsS3, whose credentials Backstage's URL reader also uses. Use an account of its own for External Storage`;
  }
  return undefined;
}

/** One line on the S3 connection, without secrets, for the startup log. */
function describeConnection(
  bucket: string,
  endpoint: string | undefined,
  region: string,
  source: S3CredentialSource,
): string {
  const credentials = {
    accessKey: `the access key of ${KEY}.credentials`,
    account: `the AWS account ${
      source.type === 'account' ? source.accountId : ''
    } of aws.accounts`,
    default: "the AWS SDK's default credential chain",
  }[source.type];
  return `External Storage reads bucket ${bucket} from ${
    endpoint ?? 'AWS S3'
  } (region ${region}) with ${credentials}`;
}

/**
 * The credentials of a source. Temporary credentials (a role, a session)
 * carry their expiry; the S3 client asks for new ones before it.
 */
export async function sourceCredentials(
  source: S3CredentialSource,
  region: string,
  credentialsManager?: AwsCredentialsManager,
): Promise<CredentialProvider> {
  switch (source.type) {
    case 'accessKey': {
      const { accessKeyId, secretAccessKey, sessionToken } = source;
      return async () => ({ accessKeyId, secretAccessKey, sessionToken });
    }
    case 'account':
      if (!credentialsManager) throw new Error('No AWS credentials manager');
      return (
        await credentialsManager.getCredentialProvider({
          accountId: source.accountId,
        })
      ).sdkCredentialProvider;
    default:
      return fromNodeProviderChain({ clientConfig: { region } });
  }
}

/**
 * An S3 client for the bucket's endpoint and region, with the credentials
 * of `source`, looked up on the first request.
 */
export function createS3Client(options: {
  endpoint?: string;
  region: string;
  forcePathStyle: boolean;
  source: S3CredentialSource;
  /** Required for an `account` source. */
  credentialsManager?: AwsCredentialsManager;
}): S3Client {
  const { endpoint, region, forcePathStyle, source, credentialsManager } =
    options;
  let provider: Promise<CredentialProvider> | undefined;
  const credentials = async () => {
    provider ??= sourceCredentials(source, region, credentialsManager).catch(
      error => {
        provider = undefined;
        throw error;
      },
    );
    return (await provider)();
  };
  return new S3Client({
    endpoint,
    region,
    forcePathStyle,
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
 * The backend only reads; the workers write. Its credentials are its own:
 * they are not those of `integrations.awsS3`, which Backstage's URL reader
 * uses to read any URL that users give it.
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
   * Reads `temporal.externalStorage.s3` (`s3`) of the root config. An
   * `accountId` takes its credentials from Backstage's `aws` config.
   */
  static fromConfig(
    config: Config,
    s3: Config,
    options: {
      logger?: LoggerService;
      credentialsManager?: AwsCredentialsManager;
    } = {},
  ): S3PayloadReader {
    const bucket = s3.getString('bucket');
    const endpoint = s3.getOptionalString('endpoint') || undefined;
    const region = s3.getOptionalString('region') || DEFAULT_REGION;
    const source = readCredentialSource(s3);
    if (source.type === 'account') {
      const warning = sharedAccountWarning(config, source.accountId);
      if (warning) options.logger?.warn(warning);
    }
    options.logger?.info(describeConnection(bucket, endpoint, region, source));
    return new S3PayloadReader({
      bucket,
      client: createS3Client({
        endpoint,
        region,
        forcePathStyle: s3.getOptionalBoolean('forcePathStyle') ?? false,
        source,
        credentialsManager:
          source.type === 'account'
            ? options.credentialsManager ??
              DefaultAwsCredentialsManager.fromConfig(config)
            : undefined,
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
      new StorageIntegrityError(
        `S3 object ${key} is larger than ${maxBytes} bytes`,
      );
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
