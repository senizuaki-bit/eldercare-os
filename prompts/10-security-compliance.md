# M10 — Security, privacy, retention and threat-model hardening

```text
Execute M10 only.

Goal:
Harden the MVP before release candidate.

Deliver:
1. ConsentRecord and SharingPreference completion for voice, AI, emotion, elder/staff location, family sharing, AI memory, content personalization, commercial recommendations and family payment/代付 foundations. Future modules may use these policies but must not be implemented early.
2. Consent withdrawal behavior and future-processing enforcement.
3. RetentionPolicy, scheduled deletion, deletion request and export request foundations.
4. Sensitive access log and user-facing/admin audit views.
5. Security headers, CORS, rate limiting, upload validation, signed URL checks and session hardening.
6. Central log redaction tests.
7. Threat model document covering IDOR, tenant escape, MQTT spoof/replay, external-content and AI prompt injection, commercial manipulation, future payment webhook replay, provider data minimization, export abuse, emergency elevation misuse and file upload.
8. Dependency/secret scanning in CI.
9. Permission regression suite across all sensitive endpoints.
10. Privacy UX copy for AI identity, location freshness, emotion limitations, family summaries, future content personalization and commercial recommendation controls.
11. Data-deletion test fixtures that verify related objects/files are handled safely.

Constraints:
- Do not claim legal certification.
- Clearly document unresolved production requirements.
- Do not weaken demo usability; use understandable consent and privacy controls.

Acceptance:
- No high-priority threat remains unmitigated without an explicit owner and release block.
- Redaction and negative authorization tests pass.
```
