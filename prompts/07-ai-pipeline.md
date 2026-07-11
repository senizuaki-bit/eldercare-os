# M07 — Provider-neutral AI pipeline, emotion trends and communication assistant

```text
Execute M07 only.

Goal:
Replace hard-coded fake flow with a provider-neutral production-ready adapter architecture while retaining fake providers for local/tests.

Deliver:
1. TranscriptionProvider, StructuredAnalysisProvider and SpeechProvider interfaces.
2. Fake providers plus one optional real-provider adapter behind environment configuration; application must run without it.
3. AI job queue, retries, timeouts, failure state, prompt/schema versioning, correlation IDs, AIProviderRun records and observability.
4. Strict structured-output validation and safe fallback.
5. AIReview workflow: reviewer sees evidence, confidence, rule hits and can correct category/urgency.
6. EmotionObservation trend model and UI: relative to personal baseline, non-diagnostic wording, review/dismiss states.
7. Family communication request -> AI draft -> reason/risk notes -> human approval -> elder-visible transparent message.
8. Prompt-injection and data-boundary defenses: AI receives only scoped minimum context.
9. Redaction: no raw transcripts in general logs.
10. AI/EMOTION/COMMUNICATION outbox events, timeline references, and fixture tests for model errors, invalid JSON, dangerous medical advice, coercive wording, leakage attempts and human correction.

Prohibited:
- impersonating family/doctor
- hidden persuasion
- medication or diagnosis advice
- AI-only emergency decisions
- automatic emotional labels presented as fact

Future boundary:
- Establish provider-neutral contracts and scoped-context helpers that M15 can wrap as restricted tools, but do not implement the multi-agent orchestrator in M07.

Acceptance:
- External AI outage does not block manual service.
- Every AI result is traceable to provider/prompt/schema and review history.
- Communication draft requires human approval and can be rejected.
```
