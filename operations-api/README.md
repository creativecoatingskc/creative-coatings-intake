# Operations API — Development

Google ID tokens must be verified server-side for every request. The web client must obtain a fresh Google Identity Services ID token and send it as `Authorization: Bearer <token>`. The existing static preview is **not** authenticated and must not store real tasks.

Required environment variables:
- `GOOGLE_CLIENT_ID`: Google OAuth web application client ID. Add the actual dashboard origin to Authorized JavaScript origins.
- `DATABASE_URL`: private Render Postgres connection URL.
- `ALLOWED_USERS`: comma-separated lowercase `email:role` pairs; roles `ceo`, `coo`, `cco`, `employee`. CEO-only system configuration is not exposed as an API yet.
- `DATABASE_SSL`: set `disable` only for trusted local development.

API: GET /api/health (no data), GET /api/me, GET/POST /api/tasks, PATCH/DELETE /api/tasks/:id.

Security: never put tokens, client secrets, or database URLs in Git. This is an initial implementation, not a completed security audit. Before employee rollout add origin restrictions, rate limiting, request validation hardening, role integration tests, audit log retention, and production-ready Google login UI.
