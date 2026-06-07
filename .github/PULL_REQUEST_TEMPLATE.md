<!--
Thanks for contributing to Construct! Please keep PRs focused — one logical change
per PR is easier to review. See CONTRIBUTING.md for conventions.
-->

## What & why

<!-- What does this change, and why? Link the issue it closes, e.g. "Closes #123". -->

## How it was tested

<!-- Commands you ran, scenarios you checked, or a minimal flow you exercised. -->

## Checklist

- [ ] `yarn typecheck` passes
- [ ] `yarn test` passes
- [ ] Docs updated (`docs/`) and the status table in `docs/roadmap.md` if behavior changed
- [ ] Dependency direction respected (nothing new points outward from `dsl`; nothing depends on the editor)

## Contract & safety

- [ ] This PR **does not** change the DSL schema — or it bumps `SCHEMA_VERSION` and updates `docs/dsl.md`
- [ ] This PR **does not** weaken the tool tier / human-approval safety model
