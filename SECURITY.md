# Security Policy

## Supported versions

This project is in pre-release prototype status. No production release lines are currently
supported for security updates.

| Version           | Supported                                     |
| ----------------- | --------------------------------------------- |
| `0.1.x` prototype | No production support; development fixes only |

When production releases begin, this table should be updated with the actively supported
major or minor release lines and their expected security maintenance windows.

## Reporting a vulnerability

If you believe you have found a vulnerability, please open a private security advisory in
GitHub or contact the repository maintainers through the project's preferred private
channel, including `quincy.j.isah@gmail.com` if that remains the published support route. Do not disclose suspected vulnerabilities publicly until maintainers have had a
reasonable opportunity to investigate and remediate them.

When reporting, include:

- Affected files, components, or versions.
- Reproduction steps or proof-of-concept details.
- Expected and observed behavior.
- Potential impact.
- Any suggested remediation.

## Scope notes

The current app is a front-end prototype and does not custody assets, connect wallets,
deploy smart contracts, or transfer USDT. Vulnerability reports about future wallet,
escrow, settlement, or smart-contract behavior should include the relevant branch, commit,
contract address, chain ID, and transaction hashes when applicable.

## Handling secrets

Never commit production secrets, private keys, seed phrases, API keys, or privileged
wallet credentials. Use local environment files ignored by Git and provide sanitized
examples through `.env.example` when configuration documentation is needed.
