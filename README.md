# JobTracker

A full-stack web app for managing job applications. Users can create an account, log in, and track their job applications through various stages of the hiring process.

**Live Demo:** [job-tracker-frontend-ten-eta.vercel.app](https://job-tracker-frontend-ten-eta.vercel.app)

---

## Features

- User authentication (register/login) with JWT
- Add job applications with company, position, status, date applied, and notes
- View, update, and delete applications
- Filter applications by status: Applied, Interviewing, Offer, Rejected

## Tech Stack

**Frontend:** React, Vite  
**Backend:** Node.js, Express  
**Database:** Supabase (PostgreSQL)  
**Auth:** JWT + bcrypt  
**Hosting:** Vercel (frontend + backend)

---

## Setup

The app is fully hosted — no local setup required. Visit the live demo link above to create an account and get started.

For local development, clone the repo and refer to the `/client` and `/server` folders. Each requires its own `.env` file with the appropriate environment variables.

---

## Notes & Trade-offs

- The backend is deployed as a serverless Express app on Vercel using `@vercel/node`, avoiding the need for a separate hosting service like Railway or Render.
- JWT tokens are stored client-side and attached to requests via Authorization headers.
- Passwords are hashed with bcrypt before being stored in Supabase.
- No mobile responsiveness per the spec — the UI is optimized for desktop.
