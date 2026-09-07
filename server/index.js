require('dotenv').config();
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const jobsRouter = require('./routes/jobsRouter')
const authRouter = require('./routes/authRouter')


const app = express();

app.use(helmet());
// Set CLIENT_ORIGIN in production (e.g. your Vercel frontend URL) to stop
// browsers from any other origin from being able to call this API.
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json());

const PORT = 8000

app.use('/auth', authRouter)
app.use('/jobs', jobsRouter)




app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

