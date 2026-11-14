---
'@kwkevinchan/backstage-plugin-temporal-backend': patch
---

The S3 credentials of External Storage come from exactly one of three
sources, and the backend does not start with none or with two:
`temporal.externalStorage.s3.credentials` (an access key of the plugin),
`temporal.externalStorage.s3.accountId` (an account of Backstage's
`aws.accounts`, with its access key, profile or role) or
`temporal.externalStorage.s3.defaultCredentials: true` (the AWS SDK's
default credential chain). The credentials stay the plugin's own: they are
not shared with `integrations.awsS3`, which Backstage's URL reader uses to
read URLs that users give. At startup the backend logs which source it
reads with, and warns when the account is one the URL reader also uses.
When S3 cannot be read, the page and the download show a generic message
and the error of S3 goes to the backend log.
