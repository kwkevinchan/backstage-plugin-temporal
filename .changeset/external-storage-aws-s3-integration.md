---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

The S3 connection and credentials of External Storage come from Backstage's
`integrations.awsS3`, so an administrator configures them once for every
plugin, with an access key, a role to assume (`roleArn`, `externalId`), the
default AWS credentials or the `endpoint` of an S3-compatible service.
`temporal.externalStorage.s3.integrationHost` selects the entry by the host
of its endpoint (default `amazonaws.com`, the AWS S3 entry), and
`temporal.externalStorage.s3.region` is the region of the bucket. The
backend does not start when `temporal.externalStorage.s3` has `endpoint`,
`forcePathStyle` or `credentials`, and says where they go. The backend
still reads the objects itself, up to 50 MiB, rather than through
Backstage's URL reader, which reads whole objects into memory.
