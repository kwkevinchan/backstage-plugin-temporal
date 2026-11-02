# Contributing

Thanks for your interest. The project is pre-alpha, so please open an issue to
discuss larger changes before sending a pull request.

## Workflow

1. Fork the repository and create a branch from `main`.
2. `corepack enable && yarn install` (this also installs the git hooks).
3. Make your change, with tests where it makes sense.
4. Run the checks locally:

   ```sh
   yarn tsc && yarn lint:all && yarn test && yarn build:all
   yarn constraints && yarn boundaries && yarn sync:common:check
   ```

5. If a published package (`plugins/*`) changes, add a changeset with
   `yarn changeset` and describe the change for users.
6. Open a pull request against `main`.

## Shared definitions

The permissions, types, annotation constants and API paths are written once,
in `plugins/temporal-backend/src/common`. Backstage does not let the frontend
plugin import the backend plugin, so `plugins/temporal/src/common` is a copy:
edit the backend files and run `yarn sync:common`. The `pre-commit` hook and
CI fail when the copy is out of date, and both packages test their
permissions against `test-fixtures/permissions.json`.

The backend reads the claim checks of large payloads and the loop markers
with its own code; the workflow kit writes them. Both are tested against
`test-fixtures/claim-checks.json` and `test-fixtures/loop-markers.json`, so
change the format there first.

## Git hooks and boundary checks

The `pre-commit` hook runs `scripts/check-boundaries.mjs` on the staged changes,
plus [gitleaks](https://github.com/gitleaks/gitleaks) when it is installed. The
`commit-msg` hook checks the commit message. CI runs the same checks on every
pull request.

The boundary check rejects local file system paths, private keys, access tokens
and private package registries. You can add your own terms, one per line, in
`~/.config/boundary/denylist.txt` or the `BOUNDARY_DENYLIST` environment
variable. Never commit that list.

Please commit with your GitHub noreply email address.

## License

By contributing you agree that your contributions are licensed under the
[Apache License, Version 2.0](LICENSE).
