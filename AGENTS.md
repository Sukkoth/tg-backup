# AGENTS.md

## Coding Conventions

### Comments

- Use **JSDoc only** for comments.
- Keep JSDoc precise, concise, and useful.
- Do not add bulky comments that restate obvious code.
- Prefer clear naming and simple code over explanatory comments.

### Naming

- Use **kebab-case** for filenames.
  - Good: `user-service.ts`
  - Avoid: `userService.ts`, `user_service.ts`
- Use **camelCase** for variables and functions.
  - Good: `userService`, `getUserById()`
  - Avoid: `user_service`, `get_user_by_id()`

## Bun

### Documentation

Always refer to the official Bun LLM documentation before making decisions about Bun APIs, behavior, or built-in functionality:

https://bun.com/llms.txt

**Never assume a Bun API or behavior. Verify it first.**

### Bun-First

When working in a Bun project:

1. Prefer **Bun-native APIs and utilities** whenever Bun provides equivalent functionality.
2. Do not use Node.js APIs simply because Bun supports them.
3. Use Node.js modules or utilities only when Bun does not provide suitable native support.
4. When unsure whether Bun provides a capability, check `https://bun.com/llms.txt` first.
5. Follow Bun's documented behavior rather than relying on Node.js conventions.

For example, if both Bun and Node provide filesystem functionality, prefer Bun's filesystem APIs instead of Node's `fs`.

### API Selection Rule

Always choose APIs in this order:

1. **Bun-native API**
2. **Node.js API only when Bun has no suitable equivalent**
3. **Never assume — verify with the Bun documentation**

The goal is to write code the **Bun way**, rather than Node.js code that merely happens to run on Bun.

## General Engineering Rules

### Existing Code

- Read the relevant existing code before making changes.
- Follow existing project patterns unless there is a strong reason to change them.
- Do not rewrite or refactor unrelated code while implementing a task.
- Prefer small, focused changes over large rewrites.
- Preserve existing behavior unless the task explicitly requires changing it.

### Dependencies

- Do not add a dependency unless it is necessary.
- Before adding a dependency, check whether Bun or the existing project already provides the required functionality.
- Prefer platform-native APIs over third-party packages when they provide equivalent functionality.
- Do not add dependencies for trivial functionality.

### TypeScript

- Use TypeScript's type system instead of runtime conventions whenever possible.
- Avoid `any`.
- Prefer explicit types at public API boundaries.
- Do not use type assertions (`as`) unless they are justified by the code.
- Prefer narrowing and type guards over unsafe type assertions.
- Keep types close to the code that owns them.
- Avoid creating types that are only used once unless they improve readability.

### Functions

- Keep functions small and focused on one responsibility.
- Avoid deeply nested control flow.
- Prefer early returns for validation and error cases.
- Do not create abstractions before they are needed.
- Prefer straightforward code over clever implementations.

### Error Handling

- Handle errors explicitly.
- Do not silently swallow errors.
- Do not use empty `catch` blocks.
- Add useful context when propagating errors.
- Do not expose sensitive information in error messages.
- Use appropriate error types rather than throwing arbitrary strings.

### Async Code

- Prefer `async`/`await` for asynchronous control flow.
- Avoid unnecessary promise chains.
- Do not introduce unnecessary concurrency.
- Use `Promise.all` only when operations are independent and can safely run concurrently.
- Always consider failure behavior when running operations concurrently.

### File System

- Prefer Bun's file system APIs over Node.js file system APIs.
- Do not use Node's `fs` or `fs/promises` when Bun provides an equivalent API.
- Verify Bun's recommended API in `https://bun.com/llms.txt` before choosing an implementation.

### Testing

- Add or update tests when changing behavior.
- Prefer testing behavior over implementation details.
- Keep tests deterministic.
- Do not rely on arbitrary timeouts or sleeps in tests.
- Do not modify tests simply to make a failing implementation pass.
- When fixing a bug, add a regression test when practical.

### Validation

- After making changes, run the relevant tests.
- Run type checking when applicable.
- Run linting/formatting when configured by the project.
- Do not claim a change works without validating it when validation is available.
- If validation cannot be performed, clearly state what was not verified.

### Security

- Never hardcode secrets, API keys, tokens, or credentials.
- Never commit `.env` files containing secrets.
- Validate untrusted input at system boundaries.
- Do not log passwords, tokens, credentials, or sensitive user data.
- Prefer established security APIs and patterns over custom cryptography or security mechanisms.

### Environment Variables

- Access environment variables through the project's established configuration pattern.
- Do not silently introduce new environment variables.
- Document newly required environment variables.
- Never provide default values for secrets or credentials.

### API Design

- Keep public APIs minimal.
- Validate inputs at API boundaries.
- Return consistent error shapes.
- Do not expose internal implementation details unnecessarily.
- Preserve backwards compatibility unless a breaking change is explicitly requested.

### Logging

- Log actionable information, not noise.
- Do not use `console.log` as permanent application logging unless the project already uses it intentionally.
- Never log secrets, authentication tokens, passwords, or sensitive data.
- Include enough context to diagnose failures without exposing sensitive information.

## Agent Behavior

### Before Changing Code

- Inspect the relevant files and understand the existing implementation.
- Identify the project's package manager, runtime, test framework, formatter, and linter.
- Check existing configuration before introducing new configuration.
- Check Bun documentation before using or recommending Bun-specific APIs.

### While Changing Code

- Make the smallest change that correctly solves the task.
- Reuse existing utilities and abstractions when appropriate.
- Do not introduce unnecessary architectural changes.
- Do not change public behavior unless required by the task.

### After Changing Code

- Review the diff for unintended changes.
- Remove unused imports, variables, and code.
- Run relevant tests and checks.
- Verify that the implementation follows these instructions.
- Summarize what changed and mention any checks that could not be run.
