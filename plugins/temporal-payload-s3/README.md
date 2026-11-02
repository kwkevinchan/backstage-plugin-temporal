# @kwkevinchan/temporal-payload-s3

A Temporal payload codec that stores large payloads in an S3-compatible
object store and keeps a small **claim check** in the workflow history
instead (the claim check pattern). It works with any service that speaks
the S3 protocol: AWS S3, RustFS, MinIO, Ceph, Cloudflare R2 and others.

The [Backstage Temporal plugin](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md) reads the claim checks and
shows the stored data on the workflow page (see
[Large payloads in S3](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/README.md#large-payloads-in-s3)).

## How it works

- `encode`: a payload whose data is larger than `thresholdBytes` (default
  128 KiB) is uploaded to S3. The history gets a payload with
  `encoding: json/claim-check` whose data is the claim check as JSON.
  Smaller payloads pass through unchanged.
- `decode`: the data is downloaded, its size and SHA-256 are checked against
  the claim check, and the original payload is restored. A mismatch throws
  `ClaimCheckIntegrityError`.

The claim check (format version 1):

```json
{
  "version": 1,
  "store": "s3",
  "bucket": "temporal-payloads",
  "key": "temporal-payloads/default/order-123/3f2a…c9",
  "size": 1048576,
  "sha256": "3f2a…c9",
  "encoding": "json/plain",
  "contentType": "application/json",
  "metadata": { "messageType": "…base64…" }
}
```

`encoding` and `metadata` are the metadata of the original payload, so
`decode` restores it exactly. `contentType` comes from a `contentType`
metadata entry when the payload has one, `application/json` for `json/*`
encodings, the file type of well-known binary data (PNG, JPEG, GIF, WebP,
PDF, gzip, zip) from its first bytes, and `application/octet-stream`
otherwise. The object in S3 holds the payload data only, so a stored PNG is
a PNG file.

### Keys

`{prefix}/{namespace}/{workflowId}/{sha256}`, with `prefix` defaulting to
`temporal-payloads`. Parts are URI encoded, so a workflow ID never adds
path segments.

- The SHA-256 makes keys content-addressed: the same data in one workflow
  (retries, repeated results) is one object.
- Everything of one workflow is under one prefix, so it can be listed or
  deleted together, and deleting one workflow's data never breaks another
  workflow. Data is not shared across workflows on purpose.
- The namespace and workflow ID come from the serialization context that
  Temporal SDKs pass to codecs (TypeScript SDK 1.24 and later). Payloads
  without a context use `_` for the missing parts.

An upload always writes the object, also when it exists, so its age starts
again and lifecycle rules (below) count from the last use.

## Usage in a worker

```sh
yarn add @kwkevinchan/temporal-payload-s3
```

```ts
import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { createS3DataConverter } from '@kwkevinchan/temporal-payload-s3';

const dataConverter = createS3DataConverter({
  store: {
    endpoint: process.env.S3_ENDPOINT, // leave out for AWS S3
    bucket: 'temporal-payloads',
    region: 'us-east-1',
    forcePathStyle: true, // most self-hosted services
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  },
  thresholdBytes: 128 * 1024,
});

const worker = await Worker.create({
  connection: await NativeConnection.connect({ address }),
  taskQueue: 'reports',
  workflowsPath: require.resolve('./workflows'),
  activities,
  dataConverter,
});

// Clients that start workflows or read results need the same codec.
const client = new Client({
  connection: await Connection.connect({ address }),
  dataConverter,
});
```

Every value comes from the options; the package does not read AWS
environment variables or profiles. To use the default AWS credential chain
(for example an IAM role), create an `S3Client` yourself and pass it as
`store.client`.

Other codecs: `createS3DataConverter({ store, codecs: [compression] })` runs
them first. Temporal encodes with the codecs in order and decodes in the
reverse order, so the S3 codec stores what the others produced. Encrypted
data is stored encrypted; Backstage then shows its size but no preview.

Lower level: `new S3PayloadCodec(options)` and `new S3PayloadStore(options)`.

## Security

- **Bucket access.** Workers need `s3:PutObject` and `s3:GetObject` on the
  prefix; Backstage needs `s3:GetObject` only. Keep the bucket private (no
  public read, no anonymous listing). Payloads often hold the same data as
  the workflow history, so give the bucket the same protection as the
  Temporal database (encryption at rest, access logs).
- **Integrity.** `decode` checks size and SHA-256, so data changed in the
  bucket is not used. The claim check itself lives in the history and is
  trusted like the rest of the history.
- **Credentials** are options of your code. Read them from a secret store or
  the environment; never commit them.

## Cleanup

The codec never deletes objects: Temporal does not tell it when a history is
deleted. Add a lifecycle rule that expires objects under the prefix some
time after the namespace's retention period, for example retention plus 7
days:

```json
{
  "Rules": [
    {
      "ID": "expire-temporal-payloads",
      "Filter": { "Prefix": "temporal-payloads/" },
      "Status": "Enabled",
      "Expiration": { "Days": 37 }
    }
  ]
}
```

Running workflows that last longer than that need a longer expiry: an
object is uploaded once when the payload is written. Because uploads
overwrite, data that a workflow writes again gets a new age.

## Local development with RustFS

```sh
PAYLOAD_S3_ACCESS_KEY=dev-access PAYLOAD_S3_SECRET_KEY=dev-secret-key \
  docker compose -f examples/docker-compose.rustfs.yaml up -d
```

RustFS listens on `http://localhost:9100` (path-style). See the
[example worker](https://github.com/kwkevinchan/backstage-plugin-temporal/blob/main/packages/example-worker/README.md) for a workflow with
large outputs.
