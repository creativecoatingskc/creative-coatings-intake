# Creative Coatings Command Center — Access Policy

Status: approved business rules; **not yet enforced in software**.

## Executive operations administrators
- Sean — CEO: full operational access, plus sole system owner for billing, integrations, admin grants and security settings.
- Troy — COO: full operational access including all tasks, teams, campaigns, approvals and performance dashboards.
- Jen — CCO: full operational access including all tasks, teams, campaigns, approvals and performance dashboards.

## Employees
- Bryan — Sales
- Myles — Installation Lead
- Madysen — Production (personal Google account)

Employees may view their assigned tasks, update status, mark completed, and flag blocked / need help with a reason. Employees may not assign, delete, or reassign tasks or access executive-only data.

## Implementation requirements
1. Google OpenID Connect login; verify ID tokens server-side including issuer, audience, expiration and email_verified. Never trust a client-side role selector.
2. Explicit email allowlist, mapped to employee IDs and roles. Do not grant access based solely on email domain. Personal Gmail is supported by allowlist.
3. Enforce permissions server-side on every API operation; executive vs employee permissions and CEO-only configuration actions.
4. Persistent database for tasks, assignments, status history, due dates, audit records and blocking reasons.
5. Scope task reads and writes to authorized users; log who changed what and when.
6. Keep customer records in their source systems; integrate read-only first with Printavo and HubSpot.
7. Never deploy sensitive data to the public static preview. Keep current demo separate until authentication and authorization have been tested.

## Rollout gate
Do not invite employees or enter real customer data until authentication, server-side authorization, persistence, and role-specific access tests pass.
