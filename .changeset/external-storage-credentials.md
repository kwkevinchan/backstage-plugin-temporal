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
reads with (the host of the endpoint, without any user or password), and
warns when the account is one the URL reader also uses. It does not start
when the `accountId` entry of `aws.accounts` has no role, access key or
profile of its own, which would read with the identity of the machine. It
warns when `defaultCredentials: true` is set and `aws.mainAccount` has no
access key or profile, because Backstage's URL reader then reads with the
same identity.
When S3 cannot be read, the page and the download show a generic message
and the error of S3 goes to the backend log.
