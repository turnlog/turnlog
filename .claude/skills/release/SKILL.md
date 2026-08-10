---
name: release
description: How to cut a Turnlog release — the version bump reaching main IS the release. Use when bumping the version, publishing to npm, editing CHANGELOG.md for a release, or writing the What's New entry.
---

# Cutting a Turnlog release

**A release IS the version bump reaching `main`.** `release.yml` publishes — and
pushes the `v*` tag itself — whenever `main`'s `package.json` version isn't on
npm yet. Merges without a bump are no-ops. Hand-pushed tags still work, but they
must match `package.json`.

Because the workflow fires on the merge, **the bump commit must carry everything
a release needs.** Nothing can be added afterwards.

## Before the bump: prove it, don't eyeball it

1. `npm run preflight` — typecheck + lint + build + full tests with strict
   exit codes. Never judge a check by piped output (`lint | tail -1` hid the
   failure that killed the v0.10.0 release run).
2. **Wait for the `development` CI matrix to be green** on the exact commit
   being released. The matrix covers 3 OSes × 2 Node lines; local runs cover
   one (the v0.10.0→v0.10.1 patch existed because a Windows-only path bug
   published). The release workflow re-runs the same matrix and refuses to
   publish past a red leg — so a red development matrix is a doomed release.
3. Check `README.md` against the `[Unreleased]` changelog — npm renders the
   README from the published tarball, so a stale one stays stale until the
   next version.

## The bump commit must contain

1. **`package.json`** — the new version.
2. **`CHANGELOG.md`** — retitle the `[Unreleased]` section to the version.
   (Every user-visible change already gets its line under `[Unreleased]` as it
   lands, in Keep a Changelog format; the release only renames the section.)
3. **`web/src/whatsnew.ts`** — that version's entry for the in-app What's New
   page (`#/whats-new`, opened via the header status dot).

## Writing the What's New entry

User-level language, grouped as **added / improved / fixed**. Plain words a user
skims — never commit messages, never internal file names. The page ships inside
the bundle; nothing is fetched at runtime.

## Keep release status notes out of this repo

The repo is public. Release status, plans, and dated notes belong in the private
documentation repo's `roadmap.md`, not in committed files here.
