require('dotenv').config();
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const cookieParser = require('cookie-parser')
const jobsRouter = require('./routes/jobsRouter')
const authRouter = require('./routes/authRouter')
const gmailRouter = require('./routes/gmailRouter')
const inboundRouter = require('./routes/inboundRouter')

const app = express();

app.use(helmet());
// CLIENT_ORIGIN can override/extend this list in other environments
// (comma-separated), but these two are always allowed since they're the
// real dev and production frontends.
const allowedOrigins = [
  "http://localhost:5173",
  "https://job-tracker-frontend-ten-eta.vercel.app",
  ...(process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(",") : []),
];
// credentials: true is required for the browser to send/accept the
// httpOnly session cookie across the frontend/backend origin split — it
// also means `origin` can never be "*", which the explicit allowlist above
// already guarantees.
app.use(cors({ origin: allowedOrigins, credentials: true }));
// Default is 100kb. The backfill upload-batch endpoint sends up to
// MAX_BATCH_SIZE (server/sync/inboundUploads.js) client-parsed messages per
// request; every other route's payloads stay far under this either way.
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const PORT = 8000

app.use('/auth', authRouter)
app.use('/jobs', jobsRouter)
app.use('/auth/gmail', gmailRouter)
app.use('/api/inbound', inboundRouter)

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

module.exports = app;