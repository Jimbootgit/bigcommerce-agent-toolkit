# Contributing

This project is in early alpha. Small, test-backed changes are preferred.

## Development

```bash
npm ci
npm run check
npm test
```

## Pull requests

- Describe the user-visible behavior and security impact.
- Add or update tests for behavior changes.
- Keep credentials and real store data out of fixtures, logs, issues, and commits.
- Preserve the fixed BigCommerce API origin and read-first default.
- Treat changes to mutation approval, filesystem access, URL handling, and secret handling as security-sensitive.

By contributing, you agree that your contribution is licensed under Apache-2.0.
