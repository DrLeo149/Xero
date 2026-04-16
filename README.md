# Live Finance Dashboard

A multi-tenant financial dashboard that pulls live data from Xero, visualizes KPIs, and gives one Admin oversight across many Client companies.

- **Admin** onboards multiple clients, manages their Xero connections, configures auto-refresh, and sees usage analytics across all tenants.
- **Client (Founder)** logs in and sees only their own dashboard — KPIs, charts, AR/AP aging, top customers, working-capital suggestions.

Built with: Node + TypeScript + Express + Prisma + `xero-node` on the backend, React + Vite + Recharts + Tailwind on the frontend. SQLite locally, Postgres in production.

---

## Prerequisites

- **Node.js 20+** ([download](https://nodejs.org))
- A **Xero developer account** with a Web app registered at https://developer.xero.com/app/manage
- The Xero app must have `http://localhost:3000/api/xero/callback` in its redirect URIs

Docker is **not** required — local dev uses SQLite.

---

## First-time setup (5 minutes)

```bash
# 1. From the project root, copy the env template into the backend
cp .env.example backend/.env
```

Then edit `backend/.env` and fill in:

- `XERO_CLIENT_ID` — from your Xero app page
- `XERO_CLIENT_SECRET` — click "Generate a secret" on your Xero app page. **Save this value here; do not paste it in chat or commit it.**
- `JWT_SECRET` — any long random string (generate with `openssl rand -hex 64`)
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` — the first admin login

Then:

```bash
# 2. Install backend dependencies, initialize the database, seed the admin
cd backend
npm install
npx prisma migrate dev --name init
npm run db:seed

# 3. Install frontend dependencies
cd ../frontend
npm install
```

---

## Run it locally

Open two terminals.

**Terminal 1 — backend:**
```bash
cd backend
npm run dev
# → http://localhost:3000
```

**Terminal 2 — frontend:**
```bash
cd frontend
npm run dev
# → http://localhost:5173
```

Visit **http://localhost:5173**, log in with the seeded admin credentials, then:

1. **Tenants** → Create a new tenant (e.g. "Xero Demo Co") + client user
2. **Tenants** → click "View" next to your new tenant (this tells the admin UI to scope subsequent API calls to that tenant)
3. **Dashboard** → Connect Xero → approve in the Xero popup → you'll be redirected back
4. **Dashboard** → Refresh now → watch the KPIs populate from the Xero demo company
5. **Analytics** → see per-tenant engagement telemetry

The client user (the email you set when creating the tenant) can log in separately and will **only** see their own tenant's dashboard — no admin controls visible or accessible.

---

## What's in here

```
backend/
  prisma/schema.prisma          Multi-tenant data model (User, Tenant, XeroConnection, XeroInvoice, UsageEvent, ...)
  src/
    index.ts                    Express server bootstrap
    lib/env.ts                  Env var loader
    db/client.ts                Prisma singleton
    db/seed.ts                  Seeds the initial admin user
    auth/jwt.ts                 JWT sign/verify
    middleware/auth.ts          requireAuth / requireRole / resolveTenant (the tenant-isolation invariant)
    api/auth.routes.ts          POST /login, GET /me
    api/xero.routes.ts          OAuth connect + callback + status + sync + disconnect
    api/dashboard.routes.ts     GET /summary (returns all KPIs/charts in one call)
    api/tenants.routes.ts       Admin-only tenant/user CRUD + cron config
    api/telemetry.routes.ts     POST /telemetry ingest + /admin/analytics/{overview,widgets,live}
    xero/client.ts              xero-node wrapper with auto token refresh
    xero/sync.ts                The core data pull pipeline
    kpi/calculators.ts          DSO, runway, revenue trend, AR aging, top customers, ratios
    kpi/suggestions.ts          Rule engine for working-capital suggestions
    scheduler/index.ts          Per-tenant node-cron jobs for auto-refresh

frontend/
  src/
    main.tsx                    React entry, starts telemetry client
    App.tsx                     Router + role-based shell
    stores/auth.ts              Zustand auth store (persisted)
    lib/api.ts                  Typed fetch wrapper, injects JWT + X-Tenant-Id
    lib/telemetry.ts            Heartbeat + event batch flusher
    hooks/useWidgetView.ts      IntersectionObserver hook for widget impression tracking
    pages/
      Login.tsx
      Dashboard.tsx             KPI cards + Recharts + overdue table + suggestions
      Settings.tsx               Xero connection + auto-refresh schedule
      admin/Tenants.tsx         Admin CRUD for tenants
      admin/Analytics.tsx       Per-tenant engagement, live presence, widget popularity
```

---

## How Xero data flows

1. **Connect** (OAuth2) — `xero-node` handles the full flow. Tokens stored in `XeroConnection` row per tenant.
2. **Sync** (manual or scheduled) — `backend/src/xero/sync.ts` runs:
   - Incremental `getContacts`, `getInvoices`, `getBankTransactions` with `modifiedSince`
   - Full snapshots of `ProfitAndLoss`, `BalanceSheet`, `AgedReceivables`, `AgedPayables`, `BankSummary`, `TrialBalance` stored as JSON
3. **Dashboard reads from cache** — `backend/src/kpi/calculators.ts` computes KPIs over the local DB. The Xero API is never hit on a dashboard page load.
4. **Auto-refresh** — `backend/src/scheduler/index.ts` registers one `node-cron` job per tenant at boot, rescheduled whenever an admin changes the cron string.

Rate-limit friendly: per-tenant concurrency is 1 sync at a time, well under Xero's 60/min limit.

---

## Deploying to Railway (app.mynumbers.io)

1. Create a new Railway project → add a **PostgreSQL** service
2. Deploy the `backend/` folder as a service, set env vars:
   - `DATABASE_URL` → Railway auto-injects from the Postgres service
   - `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `JWT_SECRET`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`
   - `FRONTEND_URL=https://app.mynumbers.io`
   - `XERO_REDIRECT_URI=https://app.mynumbers.io/api/xero/callback`
3. Change `provider` in `prisma/schema.prisma` from `sqlite` to `postgresql`, regenerate + migrate
4. Deploy the `frontend/` folder as a separate service, point its build to the backend URL
5. Add a custom domain `app.mynumbers.io` in Railway settings → update DNS (CNAME) at your registrar
6. **Add `https://app.mynumbers.io/api/xero/callback`** as a second redirect URI on your Xero developer app — Xero allows multiple, so localhost still works for dev.

---

## Troubleshooting

- **"Xero is not configured"** → You haven't set `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` in `backend/.env`. Edit the file and restart `npm run dev`.
- **OAuth callback fails with "invalid_state"** → The pending state map expired (>10 min between click and callback). Click Connect Xero again.
- **Dashboard shows all zeros** → You're connected but haven't synced yet. Click "Refresh now". If still zero, check `SyncLog` via `npx prisma studio`.
- **Can't log in after seed** → Wrong password. Delete `backend/prisma/dev.db*`, re-run `prisma migrate dev` + `db:seed`.
