# M01 — Authentication, multi-tenancy, RBAC and audit

```text
Read repository rules and execute M01 only.

Goal:
Implement secure authentication and backend-enforced authorization before business features.

Deliver:
1. Organization, Facility, User, Role, Permission, UserRole, DataScope and AuditEvent models/migrations.
2. Local seed accounts for platform admin, facility director, supervisor, caregiver, device manager, elder and family.
3. Password/session authentication suitable for local demo; secure cookie/session or well-justified token design.
4. Guards/policies for RBAC + organization/facility scope.
5. Resource-policy extension points for linked elder, assigned caregiver and active shift.
6. Audit service for sensitive reads/writes and login events.
7. Admin pages for users/roles in read-first MVP form.
8. Forbidden/not-found behavior that avoids cross-tenant enumeration.
9. Unit, integration and negative authorization tests.
10. API documentation and seed credentials documented only as fictional local demo values.

Constraints:
- Never rely on hidden UI for security.
- Do not implement elder/business modules except minimal fixtures required to test scope.
- Secrets must not be logged.
- Session invalidation/logout must work.

Acceptance:
- Cross-organization and cross-facility tests fail safely.
- Role/scope changes take effect predictably.
- Audit records include actor, action, resource, time and correlation ID without sensitive payloads.
- All checks pass and TASK_STATUS is updated.
```
