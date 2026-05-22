// SPDX-License-Identifier: Apache-2.0
//
// Vitest setup file. Runs before each test file's modules are evaluated.
// Clears harness-injected env vars so D083 harness discovery (CLAUDE_CODE_SESSION_ID)
// does not leak from the parent harness process (e.g. Claude Code running
// `vitest run` from a bash subprocess) into module-init resolution of
// ATRIB_CONTEXT_ID_DEFAULT. Tests that want to exercise the env-driven path
// should set the relevant vars explicitly inside their describe/beforeEach.

delete process.env.CLAUDE_CODE_SESSION_ID
delete process.env.ATRIB_CONTEXT_ID
