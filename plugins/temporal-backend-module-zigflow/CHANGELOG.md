# @kwkevinchan/backstage-plugin-temporal-backend-module-zigflow

## 0.1.0

### Minor Changes

- 175ba41: Restrict relative `spec.definition.target` paths to the entity's repository and require `temporal.definitions.allow` entries for absolute `http(s)` definition URLs. Entities whose `spec.definition.target` uses an absolute URL (including URLs pointing to their own repository) will show an error after upgrading unless changed to a relative path or allowed under `temporal.definitions.allow`.
- ac2997c: First release of the Definition tab for workflows written in the Serverless
  Workflow DSL and run by Zigflow. The frontend module (it needs
  `@kwkevinchan/backstage-plugin-temporal-frontend`) shows, on
  `TemporalWorkflow` entities with `spec.definition`, the YAML next to its
  graph, selecting each other, with a run of the workflow on top; with
  `format: source`, a workflow written in code shows its source with its
  function marked. The backend module (a module of
  `@kwkevinchan/backstage-plugin-temporal-backend`) serves the file
  (`GET /api/temporal/entities/:kind/:namespace/:name/definition`), read with
  the URL reader of the configured integrations, at most
  `temporal.definitions.maxBytes`. Without the backend module the tab says
  that the backend serves no workflow definitions. The frontend module's package
  root exports `EntityTemporalDefinitionContent` for the legacy frontend system;
  the new frontend system uses `./alpha`.

### Patch Changes

- 5a1728e: Recognize the Azure DevOps, GitLab, Bitbucket Server and Gitea URL shapes of a relative `spec.definition.target` only on hosts of their own integration type (and on hosts without an integration). On other hosts, such as Gerrit, AWS CodeCommit and Harness, a relative target always stays in the folder of the entity file, also when a project name looks like another provider's URL. A target rejected there now says that it must stay in the folder of the entity file. A relative target is read again for an entity file at the root of a host without an integration, such as `https://my-bucket.s3.us-east-1.amazonaws.com/catalog-info.yaml`: it may name any path of that host (the bucket, for an S3 virtual-hosted URL), but not climb out with `..`. Give such a host `paths` in `backend.reading.allow` to narrow what can be read. S3 path-style hosts are excluded.
- Updated dependencies [769a54e]
- Updated dependencies [769a54e]
- Updated dependencies [e9441a6]
- Updated dependencies [82635e4]
- Updated dependencies [2fba3c5]
- Updated dependencies [e819b25]
- Updated dependencies [65bbbf4]
- Updated dependencies [8712f0e]
- Updated dependencies [b7b17c4]
- Updated dependencies [b7b17c4]
- Updated dependencies [769a54e]
- Updated dependencies [517df3f]
- Updated dependencies [22b31ec]
- Updated dependencies [132010c]
  - @kwkevinchan/backstage-plugin-temporal-backend@0.1.0
