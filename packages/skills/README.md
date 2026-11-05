# Skills runtime

`src/registry.ts` is the trusted Skill registry used by the LangGraph worker. A Skill declares a stable ID and version, runtime, accepted input/output validators, allowed capabilities, timeout policy and license. `run` validates the request and grants only the declared capabilities. New Skills must be reviewed code or a reviewed declarative adapter; downloaded `SKILL.md` files are not executed.

The initial workflow registers browser Skills `resume.extract.v1`, `resume.parse.v1`, and `resume.confirm.v1`, plus worker Skills `assessment.score.v1`, `design.map.v1`, `resume.compose.v1`, `avatar.wibi.v1`, and `artifact.qa.v1`. The browser and worker share the pure assessment and mapping functions. `src/registry.ts` and `src/avatar-catalog.ts` are browser-safe; `src/wibi.ts` is server-only because it reads pinned local resources.

`run` enforces a wall-clock deadline and aborts its signal on timeout. `runSync` checks elapsed time after a synchronous Skill returns, because JavaScript cannot interrupt synchronous execution. Long-running capabilities must observe the signal or enforce their own process timeout; Wibi checks the signal before writing an output asset. The worker lease token still fences storage writes independently.

Wibi Style resources are pinned to commit `17880b82ea35c1fe1ec4b8f907a053d314df464f`. The adapter verifies each manifest, prompt and reference image by SHA-256, reads only three reviewed styles, and returns source/license metadata. Wibi's license includes a personal noncommercial restriction. The registry blocks commercial calls; the paid project API must independently continue rejecting Wibi artwork until commercial rights are established.

Add a Skill by defining its input/output validators, runtime, capability list, timeout and license in the registry, then test both successful execution and rejection of malformed inputs or unavailable capabilities. Do not add payment, session secrets, arbitrary shell, or unrestricted filesystem access to the capability allowlist.
