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
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { ConfigReader } from '@backstage/config';
import type { AwsCredentialsManager } from '@backstage/integration-aws-node';
import { S3PayloadReader } from './S3PayloadReader';

jest.mock('@aws-sdk/client-s3', () => ({
  ...jest.requireActual('@aws-sdk/client-s3'),
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
}));

jest.mock('@aws-sdk/credential-providers', () => ({
  ...jest.requireActual('@aws-sdk/credential-providers'),
  fromTemporaryCredentials: jest.fn(() => async () => ({
    accessKeyId: 'assumed',
    secretAccessKey: 'assumed-secret',
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
  const assume = fromTemporaryCredentials as jest.Mock;

  beforeEach(() => {
    MockS3Client.mockClear();
    assume.mockClear();
  });

  /** The options of the S3 client made from this config. */
  function clientOptions(
    data: { s3: object; [key: string]: unknown },
    credentialsManager?: AwsCredentialsManager,
  ) {
    const { s3, ...rest } = data;
    const config = new ConfigReader({
      ...rest,
      temporal: { externalStorage: { s3 } },
    });
    const reader = S3PayloadReader.fromConfig(
      config,
      config.getConfig('temporal.externalStorage.s3'),
      credentialsManager,
    );
    expect(MockS3Client).toHaveBeenCalledTimes(1);
    return { reader, options: MockS3Client.mock.calls[0][0] };
  }

  /** A credentials manager whose main account has this access key. */
  function fakeManager() {
    const main = async () => ({ accessKeyId: 'main', secretAccessKey: 'm' });
    const getCredentialProvider = jest.fn(async (opts?: { arn?: string }) => {
      if (opts?.arn) throw new Error('No AWS account of the ARN');
      return { sdkCredentialProvider: main };
    });
    return { manager: { getCredentialProvider }, main };
  }

  it('uses the AWS S3 entry and the main AWS account by default', async () => {
    const { reader, options } = clientOptions({
      aws: { mainAccount: { accessKeyId: 'main', secretAccessKey: 'm' } },
      s3: { bucket: 'payloads' },
    });
    expect(reader.bucket).toBe('payloads');
    expect(options).toMatchObject({
      region: 'us-east-1',
      endpoint: undefined,
      forcePathStyle: false,
    });
    await expect(options.credentials()).resolves.toEqual({
      accessKeyId: 'main',
      secretAccessKey: 'm',
    });
  });

  it('looks up the credentials once, on the first request', async () => {
    const { manager } = fakeManager();
    const { options } = clientOptions({ s3: { bucket: 'b' } }, manager);
    expect(manager.getCredentialProvider).not.toHaveBeenCalled();
    await options.credentials();
    await options.credentials();
    expect(manager.getCredentialProvider).toHaveBeenCalledTimes(1);
    expect(manager.getCredentialProvider).toHaveBeenCalledWith();
  });

  it('reads with the access key of the entry, in the region of the bucket', async () => {
    const { manager } = fakeManager();
    const { options } = clientOptions(
      {
        integrations: { awsS3: [{ accessKeyId: 'a', secretAccessKey: 's' }] },
        s3: { bucket: 'b', region: 'eu-central-1' },
      },
      manager,
    );
    expect(options.region).toBe('eu-central-1');
    expect(options.endpoint).toBeUndefined();
    await expect(options.credentials()).resolves.toEqual({
      accessKeyId: 'a',
      secretAccessKey: 's',
    });
    expect(manager.getCredentialProvider).not.toHaveBeenCalled();
    expect(assume).not.toHaveBeenCalled();
  });

  it('assumes the role of the entry with its access key', async () => {
    const { options } = clientOptions(
      {
        integrations: {
          awsS3: [
            {
              accessKeyId: 'a',
              secretAccessKey: 's',
              roleArn: 'arn:aws:iam::123456789012:role/payload-reader',
              externalId: 'ext',
            },
          ],
        },
        s3: { bucket: 'b', region: 'eu-central-1' },
      },
      fakeManager().manager,
    );
    await expect(options.credentials()).resolves.toEqual({
      accessKeyId: 'assumed',
      secretAccessKey: 'assumed-secret',
    });
    expect(assume).toHaveBeenCalledTimes(1);
    const [{ masterCredentials, ...rest }] = assume.mock.calls[0];
    expect(rest).toEqual({
      params: {
        RoleSessionName: 'backstage-plugin-temporal',
        RoleArn: 'arn:aws:iam::123456789012:role/payload-reader',
        ExternalId: 'ext',
      },
      clientConfig: { region: 'eu-central-1' },
    });
    await expect(masterCredentials()).resolves.toEqual({
      accessKeyId: 'a',
      secretAccessKey: 's',
    });
  });

  it('assumes the role with the AWS account of its ARN, or else the main account', async () => {
    const { manager, main } = fakeManager();
    const roleArn = 'arn:aws:iam::123456789012:role/payload-reader';
    const { options } = clientOptions(
      { integrations: { awsS3: [{ roleArn }] }, s3: { bucket: 'b' } },
      manager,
    );
    await options.credentials();
    expect(manager.getCredentialProvider).toHaveBeenNthCalledWith(1, {
      arn: roleArn,
    });
    expect(manager.getCredentialProvider).toHaveBeenNthCalledWith(2);
    expect(assume.mock.calls[0][0]).toMatchObject({
      masterCredentials: main,
      params: { RoleArn: roleArn, ExternalId: undefined },
      clientConfig: { region: 'us-east-1' },
    });
  });

  it('connects to an S3-compatible service by the host of its entry', async () => {
    const integrations = {
      awsS3: [
        {
          endpoint: 'http://localhost:9100',
          s3ForcePathStyle: true,
          accessKeyId: 'a',
          secretAccessKey: 's',
        },
      ],
    };
    const { options } = clientOptions({
      integrations,
      s3: { bucket: 'b', integrationHost: 'localhost:9100' },
    });
    expect(options).toMatchObject({
      endpoint: 'http://localhost:9100',
      forcePathStyle: true,
      region: 'us-east-1',
    });
    await expect(options.credentials()).resolves.toEqual({
      accessKeyId: 'a',
      secretAccessKey: 's',
    });

    // Without integrationHost: the AWS S3 entry that Backstage adds.
    MockS3Client.mockClear();
    const aws = clientOptions({ integrations, s3: { bucket: 'b' } }).options;
    expect(aws.endpoint).toBeUndefined();
    expect(aws.forcePathStyle).toBe(false);
  });

  it('fails without an entry of integrations.awsS3 with the host', () => {
    expect(() =>
      clientOptions({
        integrations: { awsS3: [{ endpoint: 'http://localhost:9100' }] },
        s3: { bucket: 'b', integrationHost: 'localhost:9000' },
      }),
    ).toThrow(
      'temporal.externalStorage.s3.integrationHost is localhost:9000, but no entry of integrations.awsS3 has this host (the host and port of its endpoint, for example localhost:9000 for http://localhost:9000). Hosts: localhost:9100, amazonaws.com',
    );
    expect(MockS3Client).not.toHaveBeenCalled();
  });

  it('refuses the keys whose settings belong to integrations.awsS3', () => {
    expect(() =>
      clientOptions({
        s3: {
          bucket: 'b',
          credentials: { accessKeyId: 'a', secretAccessKey: 's' },
        },
      }),
    ).toThrow(
      'Unsupported config temporal.externalStorage.s3.credentials: the S3 connection and credentials of External Storage come from integrations.awsS3. Set accessKeyId and secretAccessKey (or roleArn) in an entry of integrations.awsS3, and temporal.externalStorage.s3.integrationHost to the host of its endpoint (leave it out for AWS S3)',
    );
    expect(() =>
      clientOptions({
        s3: {
          bucket: 'b',
          endpoint: 'http://localhost:9100',
          forcePathStyle: true,
        },
      }),
    ).toThrow(
      /^Unsupported config temporal\.externalStorage\.s3\.endpoint, temporal\.externalStorage\.s3\.forcePathStyle: .* Set endpoint; s3ForcePathStyle in an entry of integrations\.awsS3/,
    );
    expect(MockS3Client).not.toHaveBeenCalled();
  });
});
