// SPDX-License-Identifier: Apache-2.0
//
// Vitest setup file. Runs before each test file's modules are evaluated.
// Clears D083 harness discovery env vars so the parent harness process does
// not leak its active session into module-init resolution of
// ATRIB_CONTEXT_ID_DEFAULT. Tests that exercise the env-driven path should
// set the relevant vars explicitly inside their describe/beforeEach.

delete process.env.ATRIB_ACTIVE_SESSION_PROFILE
delete process.env.ATRIB_AGENT
delete process.env.CLAUDE_CODE_SESSION_ID
delete process.env.CODEX_THREAD_ID
delete process.env.ATRIB_CONTEXT_ID
