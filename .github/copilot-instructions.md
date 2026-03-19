# Copilot Instructions for AI Grammar Checker Extension

- Follow the phased roadmap in jazzy-knitting-cascade.md strictly.
- Order: Phase 1 Correctness → Phase 2 Stable UX → Phase 3 Performance.
- Commit per sub-task with messages like "Phase 1.1: Fix All one-shot convergence".
- Prioritize Fix All convergence and local punctuation rules before any parallelism.
- Update CHANGELOG.md, manifest.json, package.json for version bumps.
- Test changes in Gmail compose whenever possible.
- Use TypeScript strict mode, avoid console.log in production code.
