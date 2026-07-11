# M05 — IoT registry, MQTT ingestion and offline operations

```text
Execute M05 only.

Goal:
Implement provider-neutral device monitoring and the offline safety fallback workflow.

Deliver:
1. Device, binding, heartbeat, telemetry, event, alert, maintenance order and fallback patrol models.
2. Versioned MQTT topic parser and JSON schema validation from docs/06-AI-IOT-CONTRACTS.md.
3. iot-simulator commands/scenarios for heartbeats, battery, location, emergency button, disconnect and recovery.
4. Offline detector based on expected interval + tolerance.
5. Idempotent active alerts and stable recovery window.
6. Critical device offline workflow: alert + maintenance task + fallback patrol.
7. Admin device inventory, health dashboard, alert queue and detail timeline.
8. Device manager permissions and audit.
9. Metrics for online/offline devices and ingestion failures.
10. DEVICE/LOCATION/FALLBACK_PATROL outbox events, timeline references and tests for duplicate eventId, out-of-order time, spoofed tenant path, offline/recovery, event replay and fallback patrol.

Constraints:
- Never accept organization/facility identifiers from topic without validating device registration.
- Device recovery does not silently close human tasks.
- Do not store unlimited raw telemetry; document retention/aggregation approach.

Acceptance:
- Stopping a critical device heartbeat produces exactly one active alert and safety patrol.
- Stable recovery marks RECOVERED, then human closes.
```
