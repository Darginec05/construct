# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).
With it you record the intent of a change so the release pipeline can version and
publish the packages for you.

All publishable `@construct/*` packages are versioned in lockstep (`fixed` group),
so a single changeset bumps every package to the same version — even the ones a
given change did not touch.

## Adding a changeset

```sh
yarn changeset
```

Pick the bump level (for a `fixed` group, targeting one package is enough — all of
them move together) and write a one-line summary. Commit the generated file in
`.changeset/` alongside your change.

## How a release happens

1. Merge a PR that contains one or more changeset files into `main`.
2. The release workflow opens/updates a **"Release: version packages"** PR that runs
   `changeset version` (bumps versions, writes CHANGELOGs, deletes consumed changesets).
3. Merging that PR publishes every package to npm with provenance and tags the release.
