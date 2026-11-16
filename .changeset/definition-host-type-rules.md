---
'@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow': patch
---

Recognize the Azure DevOps, GitLab, Bitbucket Server and Gitea URL shapes of a relative `spec.definition.target` only on hosts of their own integration type (and on hosts without an integration). On other hosts, such as Gerrit, AWS CodeCommit and Harness, a relative target always stays in the folder of the entity file, also when a project name looks like another provider's URL. A target rejected there now says that it must stay in the folder of the entity file. A relative target is read again for an entity file at the root of a bucket host, such as `https://my-bucket.s3.us-east-1.amazonaws.com/catalog-info.yaml`: it may name files in that bucket, but not climb out with `..`.
