---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
'@kwkevinchan/backstage-plugin-temporal-frontend': patch
---

The plugin no longer reads payloads from Temporal External Storage. It shows
where a stored payload is, from the reference in the history: the location
(`s3://bucket/key`), the SHA-256 and the size, with copy buttons, for the
inputs and results of steps, the memo and the record of a model call. The
History tab and the raw events show the events as JSON, where a stored
payload appears as `{ encoding, external }`. A model call whose result is stored there shows no model or tokens, and
a tool step whose arguments are stored there is matched to its model call by
the tool name alone.

Removed from the backend: the `temporal.externalStorage.s3` settings
(`bucket`, `driverName`, `endpoint`, `region`, `forcePathStyle`,
`credentials`, `accountId`, `defaultCredentials`, `maxInlineBytes`,
`previewBytes`), the `GET .../payloads/download` routes, and the
dependencies `@aws-sdk/client-s3`, `@aws-sdk/credential-providers` and
`@backstage/integration-aws-node`. The backend no longer needs access to the
bucket. `ExternalPayload` in `./common` only has `store`, `bucket`, `key`,
`size` and `sha256`.

Removed from the frontend: `downloadPayload` of `TemporalApi`, and the
preview, thumbnail and download of stored payloads.

New, in the frontend: `temporal.externalStorage.objectUrl`, a URL template
with `{bucket}` and `{key}` (replaced with the URL-encoded values). When it
is set and starts with `https:`, an Open link goes next to the location.
