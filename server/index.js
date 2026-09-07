require('dotenv').config();
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const jobsRouter = require('./routes/jobsRouter')
const authRouter = require('./routes/authRouter')

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
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

const PORT = 8000

app.use('/auth', authRouter)
app.use('/jobs', jobsRouter)

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

module.exports = app;