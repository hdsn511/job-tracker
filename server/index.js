require('dotenv').config();
const express = require('express')
const cors = require('cors')
const jobsRouter = require('./routes/jobsRouter')
const authRouter = require('./routes/authRouter')


const app = express();

app.use(cors());
app.use(express.json());

const PORT = 8000

app.use('/auth', authRouter)
app.use('/jobs', jobsRouter)




app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

