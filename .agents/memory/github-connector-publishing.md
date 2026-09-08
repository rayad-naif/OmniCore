---
name: GitHub connector publishing
description: Durable limits and verification rules for publishing OmniCore through the connected GitHub API.
---

When normal Git authentication is unavailable, the connected GitHub Contents API can synchronize most files, but Cloudflare may return HTML `403` responses for workflow paths and false-positive content bodies. Git blob creation may succeed while Git tree creation remains unavailable, so orphan blobs do not mean the branch was updated.

**Why:** Multiple REST, SDK, GraphQL, encoded-path, and line-wrapped-base64 attempts hit the same connector-layer filter. Upload response counts alone would have overstated what reached `main`.

**How to apply:** Prefer normal `git push`. If using the connector fallback, compare the remote recursive tree's blob SHAs against local Git blob SHAs. Report any mismatches precisely and never claim a complete push when the branch lacks files.