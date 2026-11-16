---
'@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow': patch
---

Recognize the Azure DevOps, GitLab, Bitbucket Server and Gitea URL shapes of a relative `spec.definition.target` only on hosts of their own integration type (and on hosts without an integration). On other hosts, such as Gerrit, AWS CodeCommit and Harness, a relative target always stays in the folder of the entity file, also when a project name looks like another provider's URL. A target rejected there now says that it must stay in the folder of the entity file. A relative target is read again for an entity file at the root of a host without an integration, such as `https://my-bucket.s3.us-east-1.amazonaws.com/catalog-info.yaml`: it may name any path of that host (the bucket, for an S3 virtual-hosted URL), but not climb out with `..`. Give such a host `paths` in `backend.reading.allow` to narrow what can be read. S3 path-style hosts are excluded.
