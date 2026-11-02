---
'@kwkevinchan/temporal-payload-s3': minor
'@kwkevinchan/backstage-plugin-temporal-backend': minor
'@kwkevinchan/backstage-plugin-temporal-common': minor
'@kwkevinchan/backstage-plugin-temporal-react': minor
'@kwkevinchan/backstage-plugin-temporal': minor
---

Large payloads in S3-compatible storage (claim check pattern).

The new `@kwkevinchan/temporal-payload-s3` package is a Temporal payload
codec for workers and clients: payloads larger than a threshold (default
128 KiB) are uploaded to S3, and the history keeps a claim check
(`json/claim-check`) with the bucket, key, size, SHA-256, original encoding
and media type. Decoding downloads the data and checks its SHA-256. Keys are
`{prefix}/{namespace}/{workflowId}/{sha256}`.

With `temporal.payloads.s3` configured, the backend shows the stored data:
JSON up to `maxInlineBytes` (default 256 KiB) like any other payload, larger
data with its size and a text preview, and serves downloads through
`.../payloads/download?key=` with the history permission. Without the
configuration, claim checks are shown as stored externally. The step panel
shows an icon, the size, the preview, a download button and a thumbnail of
images. `TemporalApi` has an optional `downloadPayload` method.
