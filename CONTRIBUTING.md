# Contributing to CodeClosure

CodeClosure welcomes focused contributions that strengthen its local-first
control runtime for AI coding agents.

## Good contribution areas

- bug fixes with a clear reproduction;
- CLI, adapter, SQLite-store, and recovery hardening;
- tests that protect an existing authority boundary or regression baseline;
- documentation that helps users understand setup, concepts, or safe operation.

## Before opening a pull request

1. Open or reference an issue that describes the problem or improvement.
2. Keep the change bounded to one coherent outcome.
3. Preserve CodeClosure's core authority rule: workers may propose and edit, but
   CodeClosure owns goal state, evidence, verification, acceptance, and closeout.
4. Run the narrow relevant check. For cross-surface changes, use:

   ```sh
   corepack pnpm gate:quality
   ```

5. Include the verification command and result in the pull request.

## AI-assisted contributions

AI-assisted changes are welcome when the human contributor remains responsible
for the result. Please review generated code before submitting it, remove
unneeded generated artifacts, and verify the affected path with the repository's
checks.

## License

By contributing to CodeClosure, you agree that your contribution is licensed
under the Apache License, Version 2.0.
