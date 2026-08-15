# Security Policy

## Supported versions

This project is an early alpha. Security fixes are applied to the current `main` branch and latest release only.

## Reporting a vulnerability

Do not open a public issue for suspected credential exposure, origin bypass, approval bypass, path traversal, or unsafe mutation behavior.

Use GitHub's private vulnerability reporting for this repository. Include the affected version, reproduction steps, impact, and any suggested mitigation.

Never include live BigCommerce credentials or customer store data in a report.

## Credential model

The toolkit reads a store hash and scoped API token from the process environment. Use a dedicated least-privilege API account. Do not commit credentials, proposal snapshots containing sensitive store data, or `.env` files.

Mutation application is CLI-only. Keep `BIGCOMMERCE_APPROVAL_SECRET` outside the MCP server environment. Each application attempt atomically consumes its proposal before contacting BigCommerce and writes a durable `.applied.json` audit artifact. An unresolved `.applying` marker must be investigated manually, not deleted and retried blindly.
