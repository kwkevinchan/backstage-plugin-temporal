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

import { S3Client } from '@aws-sdk/client-s3';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { ConfigReader } from '@backstage/config';
import type { AwsCredentialsManager } from '@backstage/integration-aws-node';
import { S3PayloadReader } from './S3PayloadReader';

jest.mock('@aws-sdk/client-s3', () => ({
  ...jest.requireActual('@aws-sdk/client-s3'),
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
}));

jest.mock('@aws-sdk/credential-providers', () => ({
  ...jest.requireActual('@aws-sdk/credential-providers'),
  fromNodeProviderChain: jest.fn(() => async () => ({
    accessKeyId: 'machine',
    secretAccessKey: 'machine-secret',
  })),
}));

/** A fake S3 client that answers GetObject with these bytes. */
function fakeClient(
  object: Uint8Array,
  options: { ignoreRange?: boolean; chunked?: boolean } = {},
) {
  const destroy = jest.fn();
  const send = jest.fn(async (command: any) => {
    const range: string | undefined = command.input.Range;
    if (range && !options.ignoreRange && object.length === 0) {
      // What S3 answers for a range of an empty object.
      throw Object.assign(new Error('The requested range is not satisfiable'), {
        name: 'InvalidRange',
        $metadata: { httpStatusCode: 416 },
      });
    }
    const match =
      range && !options.ignoreRange && /^bytes=0-(\d+)$/.exec(range);
    const body = match ? object.slice(0, Number(match[1]) + 1) : object;
    return {
      Body: { transformToByteArray: async () => body, destroy },
      ...(options.chunked ? {} : { ContentLength: body.length }),
      ...(match
        ? { ContentRange: `bytes 0-${body.length - 1}/${object.length}` }
        : {}),
    };
  });
  return { send, destroy };
}

describe('S3PayloadReader', () => {
  const bytes = (n: number) => new Uint8Array(n).fill(7);

  it('reads an object up to the limit, asking for one byte more', async () => {
    const client = fakeClient(bytes(10));
    const reader = new S3PayloadReader({ bucket: 'b', client });
    expect((await reader.get('k', 10)).length).toBe(10);
    expect(client.send.mock.calls[0][0].input).toEqual({
      Bucket: 'b',
      Key: 'k',
      Range: 'bytes=0-10',
    });
  });

  it('refuses a larger object from its Content-Range, without reading it', async () => {
    const client = fakeClient(bytes(11));
    const reader = new S3PayloadReader({ bucket: 'b', client });
    await expect(reader.get('k', 10)).rejects.toThrow(
      'S3 object k is larger than 10 bytes',
    );
    expect(client.destroy).toHaveBeenCalled();
  });

  it('refuses a larger object when the service ignores the range', async () => {
    const client = fakeClient(bytes(11), { ignoreRange: true });
    const reader = new S3PayloadReader({ bucket: 'b', client });
    await expect(reader.get('k', 10)).rejects.toThrow('larger than 10 bytes');
  });

  it('refuses a larger object sent without a length', async () => {
    const client = fakeClient(bytes(11), { ignoreRange: true, chunked: true });
    const reader = new S3PayloadReader({ bucket: 'b', client });
    await expect(reader.get('k', 10)).rejects.toThrow('larger than 10 bytes');
  });

  it('reads an empty object, whose range S3 refuses', async () => {
    const reader = new S3PayloadReader({
      bucket: 'b',
      client: fakeClient(bytes(0)),
    });
    expect((await reader.get('k', 10)).length).toBe(0);
  });

  it('reads the whole object without a limit', async () => {
    const client = fakeClient(bytes(11));
    const reader = new S3PayloadReader({ bucket: 'b', client });
    expect((await reader.get('k')).length).toBe(11);
    expect(client.send.mock.calls[0][0].input.Range).toBeUndefined();
  });
});

describe('S3PayloadReader.fromConfig', () => {
  const MockS3Client = S3Client as unknown as jest.Mock;
  const defaultChain = fromNodeProviderChain as jest.Mock;
  const accountId = '123456789012';

  beforeEach(() => {
    MockS3Client.mockClear();
    defaultChain.mockClear();
  });

  function logger() {
    return { info: jest.fn(), warn: jest.fn() };
  }

  /** Reads this config; returns the options of the S3 client and the log. */
  function read(
    data: { s3: object; [key: string]: unknown },
    credentialsManager?: AwsCredentialsManager,
  ) {
    MockS3Client.mockClear();
    const { s3, ...rest } = data;
    const config = new ConfigReader({
      ...rest,
      temporal: { externalStorage: { s3 } },
    });
    const log = logger();
    const reader = S3PayloadReader.fromConfig(
      config,
      config.getConfig('temporal.externalStorage.s3'),
      { logger: log as any, credentialsManager },
    );
    expect(MockS3Client).toHaveBeenCalledTimes(1);
    return { reader, options: MockS3Client.mock.calls[0][0], log };
  }

  /** A credentials manager with one account. */
  function fakeManager() {
    const account = async () => ({
      accessKeyId: 'account',
      secretAccessKey: 'account-secret',
      sessionToken: 'token',
      expiration: new Date(Date.now() + 3600_000),
    });
    return {
      getCredentialProvider: jest.fn(async () => ({
        accountId,
        sdkCredentialProvider: account,
      })),
    };
  }

  it('reads with the access key of the plugin', async () => {
    const { reader, options, log } = read({
      s3: {
        bucket: 'payloads',
        endpoint: 'http://localhost:9100',
        forcePathStyle: true,
        credentials: {
          accessKeyId: 'a',
          secretAccessKey: 's',
          sessionToken: 't',
        },
      },
    });
    expect(reader.bucket).toBe('payloads');
    expect(options).toMatchObject({
      endpoint: 'http://localhost:9100',
      region: 'us-east-1',
      forcePathStyle: true,
    });
    await expect(options.credentials()).resolves.toEqual({
      accessKeyId: 'a',
      secretAccessKey: 's',
      sessionToken: 't',
    });
    expect(defaultChain).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      'External Storage reads bucket payloads from http://localhost:9100 (region us-east-1) with the access key of temporal.externalStorage.s3.credentials',
    );
    expect(JSON.stringify(log.info.mock.calls)).not.toMatch(/"s"|"t"/);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('reads with an account of aws.accounts, once, on the first request', async () => {
    const manager = fakeManager();
    const { options, log } = read(
      {
        aws: { accounts: [{ accountId, roleName: 'payload-reader' }] },
        s3: { bucket: 'b', region: 'eu-central-1', accountId },
      },
      manager,
    );
    expect(options).toMatchObject({
      endpoint: undefined,
      region: 'eu-central-1',
      forcePathStyle: false,
    });
    expect(manager.getCredentialProvider).not.toHaveBeenCalled();
    const first = await options.credentials();
    await options.credentials();
    expect(first).toMatchObject({
      accessKeyId: 'account',
      sessionToken: 'token',
    });
    // Temporary credentials keep their expiry, for the client to refresh.
    expect(first.expiration).toBeInstanceOf(Date);
    expect(manager.getCredentialProvider).toHaveBeenCalledTimes(1);
    expect(manager.getCredentialProvider).toHaveBeenCalledWith({ accountId });
    expect(log.info).toHaveBeenCalledWith(
      `External Storage reads bucket b from AWS S3 (region eu-central-1) with the AWS account ${accountId} of aws.accounts`,
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("takes the account from Backstage's aws config", async () => {
    const { options } = read({
      aws: {
        accounts: [{ accountId, accessKeyId: 'acc', secretAccessKey: 'acc-s' }],
      },
      s3: { bucket: 'b', accountId },
    });
    await expect(options.credentials()).resolves.toEqual({
      accessKeyId: 'acc',
      secretAccessKey: 'acc-s',
    });
  });

  it('warns when the account is shared with the URL reader', () => {
    const notListed = read(
      { s3: { bucket: 'b', accountId } },
      fakeManager(),
    ).log;
    expect(notListed.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /^temporal\.externalStorage\.s3\.accountId 123456789012 is not in aws\.accounts, so it can only be the main AWS account/,
      ),
    );
    const roleArn = read(
      {
        aws: { accounts: [{ accountId, roleName: 'reader' }] },
        integrations: {
          awsS3: [{ roleArn: `arn:aws:iam::${accountId}:role/catalog-reader` }],
        },
        s3: { bucket: 'b', accountId },
      },
      fakeManager(),
    ).log;
    expect(roleArn.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /is the account of a roleArn in integrations\.awsS3/,
      ),
    );
    const own = read(
      {
        aws: { accounts: [{ accountId, roleName: 'reader' }] },
        integrations: {
          awsS3: [{ roleArn: 'arn:aws:iam::210987654321:role/catalog-reader' }],
        },
        s3: { bucket: 'b', accountId },
      },
      fakeManager(),
    ).log;
    expect(own.warn).not.toHaveBeenCalled();
  });

  it('reads with the default credential chain only when asked to', async () => {
    const { options, log } = read({
      s3: { bucket: 'b', region: 'ap-northeast-1', defaultCredentials: true },
    });
    expect(defaultChain).not.toHaveBeenCalled();
    await expect(options.credentials()).resolves.toEqual({
      accessKeyId: 'machine',
      secretAccessKey: 'machine-secret',
    });
    expect(defaultChain).toHaveBeenCalledWith({
      clientConfig: { region: 'ap-northeast-1' },
    });
    expect(log.info).toHaveBeenCalledWith(
      "External Storage reads bucket b from AWS S3 (region ap-northeast-1) with the AWS SDK's default credential chain",
    );
  });

  it('needs exactly one source of credentials', () => {
    const none =
      "temporal.externalStorage.s3 needs exactly one source of S3 credentials, and has none: credentials (an access key with accessKeyId and secretAccessKey), accountId (an account of aws.accounts) or defaultCredentials: true (the AWS SDK's default credential chain)";
    expect(() => read({ s3: { bucket: 'b' } })).toThrow(none);
    expect(() =>
      read({ s3: { bucket: 'b', defaultCredentials: false } }),
    ).toThrow(none);
    expect(() =>
      read({
        s3: {
          bucket: 'b',
          credentials: { accessKeyId: 'a', secretAccessKey: 's' },
          accountId,
        },
      }),
    ).toThrow(/and has credentials, accountId:/);
    expect(() =>
      read({ s3: { bucket: 'b', accountId, defaultCredentials: true } }),
    ).toThrow(/and has accountId, defaultCredentials:/);
    expect(() =>
      read({ s3: { bucket: 'b', credentials: { accessKeyId: 'a' } } }),
    ).toThrow(/secretAccessKey/);
    expect(() => read({ s3: { bucket: 'b', accountId: '1234' } })).toThrow(
      'temporal.externalStorage.s3.accountId must be an AWS account ID of 12 digits',
    );
    expect(MockS3Client).not.toHaveBeenCalled();
  });
});
