# CI / Build Status

![CI](https://github.com/quincyjisah/CRYPTO-CHESS-USTD/actions/workflows/ci.yml/badge.svg?branch=main)

# CRYPTO-CHESS-USTD

<div align="center">

<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

  <h1>Built with AI Studio</h2>

  <p>The fastest path from prompt to production with Gemini.</p>

  <a href="https://aistudio.google.com/apps">Start building</a>

</div>

## Developer setup

This repository currently contains CI/configuration added by the audit branch. At present there is no detected application source code or package manifests. To get the project ready for deployment, follow these steps:

1. Add your application source and dependency manifest(s):
   - Node: add package.json (and package-lock.json or yarn.lock)
   - Python: add pyproject.toml or requirements.txt
   - Other: add the appropriate manifests

2. Add tests and a test script. For Node, add a "test" script in package.json. For Python, add pytest tests in a tests/ directory.

3. Add a Dockerfile at the repo root if you plan to deploy as a container.

4. Enable GitHub Actions and observe CI runs on push/PR. The CI will:
   - Detect Node/Python projects and run installs, linters, tests
   - Attempt to build a Docker image if a Dockerfile is present

5. To deploy a container to GitHub Container Registry (GHCR) using the provided deploy workflow:
   - Either rely on the built-in GITHUB_TOKEN or provide a personal access token in repository secrets if needed.
   - Trigger the "Deploy (manual)" workflow in Actions > Workflows > Deploy.

If you'd like, I can scaffold a sample application (Node or Python) plus example tests and a Dockerfile. Tell me which runtime you prefer and I will add the sample app and tests.

