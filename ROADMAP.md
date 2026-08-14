# BigCommerce Agent Toolkit public-alpha pilot

## Goal

Prepare a small, honest public alpha that gives MCP clients safe BigCommerce documentation and store access without becoming an arbitrary authenticated HTTP wrapper.

## Required before public release

- [x] Replace the self-derived approval code with a separately held HMAC approval secret.
- [x] Restrict proposal reads and writes to a configured operations directory.
- [x] Add traversal, symlink, credential-redaction, and mutation-bypass tests.
- [x] Add first-class product reviews, redirects, placements, widget templates, themes, and channels reads.
- [x] Add before-and-after snapshots for approved writes.
- [x] Document the minimum OAuth scopes for each tool.
- [x] Run an independent security and API-design review.
- [x] Confirm no client names, store hashes, credentials, private paths, or store data exist in the repository or Git history.
- [ ] Obtain explicit human approval before making the GitHub repository public or publishing a release.

## Pilot evidence

Record tests, review findings, approval decisions, and release handles in the pilot work item. Keep live merchant credentials and store data outside the collaboration system.
