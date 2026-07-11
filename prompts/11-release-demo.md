# M11 — Release candidate, deployment and demo

```text
Execute M11 only.

Goal:
Produce a reproducible core-care release candidate and polished local demo. This is the M00–M11 checkpoint, not the final M12–M16 platform release.

Deliver:
1. Production-minded Dockerfiles and compose profiles for local demo.
2. CI pipeline for lint, typecheck, unit, integration, E2E and build.
3. Database migration/seed/reset procedures and rollback notes.
4. One-command or clearly documented demo startup.
5. Health/readiness checks and basic metrics dashboard/documentation.
6. Complete fictional demo dataset and IoT scenario scripts.
7. DEMO.md with the ten-step scripted demonstration and expected outcomes.
8. Smoke test after fresh clone.
9. Core route/API/event inventory, architecture diagram, known limitations, and documented extension prerequisites for M12–M16.
10. Release checklist and security/privacy pre-production checklist.
11. Screenshots generated from the implemented app, not copied reference images.
12. Remove dead code, debug endpoints and unsafe test bypasses.

Acceptance:
- A clean environment can start the core system from documentation.
- Ten-step demo passes twice from reset state.
- All automated tests pass.
- No real keys/data or copied branding/assets are included.
- TASK_STATUS marks every milestone with evidence.
```
