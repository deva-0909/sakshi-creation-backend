# API naming conventions (§55)

## Why this exists, and why it's a doc rather than a rename

The audit (§55) flagged that route verbs/paths are inconsistent across
modules — e.g. `/getall` vs `/all`, `/getbyid/:id` vs `/:id`,
`/update/:id` vs `/updatebyid/:id` vs `/updatestatus/:id`. That's real,
but every one of these paths is hardcoded in the separately-deployed
frontend (Next.js) codebase, which is not in this repo and not
redeployed atomically with the backend. Renaming a live route here
without a coordinated, simultaneously-deployed frontend change would
break that endpoint in production the moment this deploys — for a
cosmetic inconsistency, not a bug. That risk/value tradeoff is why
existing endpoints are left as-is rather than mass-renamed.

Instead: this file is the convention new/changed endpoints follow, so
the API stops getting *more* inconsistent, and existing endpoints get
migrated opportunistically — only when a route is being touched anyway
for an unrelated change, and only with a matching frontend patch in the
same delivery.

## Convention

- **Resource-oriented paths, HTTP verb carries the action** — not a verb
  baked into the path. `GET /orders`, not `GET /orders/getall`.
- **Collection vs. member**: `GET /orders` (list), `GET /orders/:id`
  (one), `POST /orders` (create), `PATCH /orders/:id` (partial update),
  `DELETE /orders/:id` (soft-delete, matching this app's `is_delete`
  pattern).
- **Sub-actions that aren't plain CRUD** are a nested path segment, not
  a query param or a verb prefix: `PATCH /orders/:id/status`, not
  `POST /orders/updatestatus/:id`.
- **Bulk operations**: `POST /<resource>/bulk` (import), `GET
  /<resource>/bulk/template` (template download) — this shape is already
  in place across all seven bulk-import modules (§77) and is the
  reference for anything bulk-shaped going forward.
- **Query params for filtering/search/pagination**, not separate routes
  per filter (`GET /leads?status=pending`, not `GET /leads/getbystatus`).

## Status of existing routes

Existing routes are grandfathered and unchanged by this doc — see the
route files under `routes/` for the current (inconsistent) paths, which
remain the source of truth for what the frontend actually calls. All
work from §77 onward (bulk-import endpoints, `/import-history/:module`)
already follows the convention above, so no further action was needed
there.
