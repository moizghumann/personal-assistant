## Hono CLI

Run `npx hono --help` first, and use the CLI instead of a dev server.
Run `npx hono routes --external ai` from the repo root to inspect the Hono app.
Pass `--external ai` when a Hono CLI command loads the app so Node resolves the AI SDK.

## Verification

1. Run the check using the documented command and entry point that a maintainer would use from a fresh checkout with the declared dependencies installed.
2. If that workflow fails, inspect the relevant entry points and dependencies to find the cause. Fix in-scope repo issues unless the request is for a read-only audit. Keep application logic independently testable where practical.
3. Use temporary copies, shims, or separate installs only to diagnose failures. A passing check through a workaround does not count as completion.
4. After a fix, rerun the documented workflow against the actual repo files and check any affected entry points. If the normal workflow still fails or cannot be run, report verification as incomplete and name the blocker.
