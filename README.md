# JobTracker

A full-stack web app for tracking job applications. Sign up, connect Gmail, and the
app builds your pipeline out of your inbox — application confirmations, assessments,
interview invites and rejections, classified and grouped by company.

**Live Demo:** [job-tracker-frontend-ten-eta.vercel.app](https://job-tracker-frontend-ten-eta.vercel.app)

---

## User flow

1. **Register / log in** (`/`) — JWT stored client-side.
2. **Connect your inbox** (`/connect`) — Google OAuth for read-only Gmail. Skippable;
   the tracker works with applications added by hand.
3. **Dashboard** (`/dashboard`) — a single "rail & detail" screen: stage filter and
   account actions in the left rail, a Sankey view of the pipeline, a contribution
   calendar and headline stats, then the application list with a detail panel.

## Features

- Sankey funnel from applications through reviewed / interview / offer
- 10-week contribution calendar of application activity
- Applications, still-live count, reply rate and median time-to-first-response
- Stage filter, inline stage changes, manual add / edit, archive
- Timeline per application, parsed from the sync's inbox notes
- **Resync inbox** on demand, plus a scheduled sync twice daily

## Tech Stack

**Frontend:** React 18, Vite, React Router
**Backend:** Node.js, Express
**Database:** Neon (PostgreSQL)
**Auth:** JWT + bcrypt; Gmail OAuth with refresh tokens encrypted at rest (AES-256-GCM)
**Email sync:** rule-based classifier with a Gemini fallback (`server/sync/`)
**Hosting:** Vercel (frontend + backend), GitHub Actions for the scheduled sync

## Layout

| Path | What it is |
| --- | --- |
| `client/` | React app. `src/pages` are the three screens, `src/components/dashboard` the dashboard pieces, `src/lib/applications.js` all derived data (funnel, calendar, stats, note parsing). |
| `server/` | Express API: `/auth`, `/jobs`, `/auth/gmail`. |
| `server/sync/` | The Gmail → jobs pipeline. `index.js` is the engine; `scripts/sync-all.js` (`npm run sync`) is the scheduled entry point and `POST /auth/gmail/sync` runs the same code for one user. |

## Setup

```bash
# database — run once against a fresh Neon database
#   server/schema.sql
#   server/sql/001_gmail_connections.sql
# existing databases also need:
#   server/sql/002_jobs_archived.sql

cd server && npm install && cp .env.example .env   # fill it in, then:
npm run dev        # http://localhost:8000

cd ../client && npm install
npm run dev        # http://localhost:5173
```

`server/.env` needs `DATABASE_URL`, `JWT_SECRET`, the `GMAIL_*` OAuth trio,
`TOKEN_ENCRYPTION_KEY` and `GROQ_API_KEY` for the classifier
fallback. See `server/.env.example`.

The scheduled sync (`.github/workflows/sync-emails.yml`) runs from `server/`
too, so the API and the cron share one dependency tree — which is what lets
a `server`-rooted Vercel deploy serve `POST /auth/gmail/sync`.
