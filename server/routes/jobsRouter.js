const express = require('express');
const auth = require('../middleware/authMiddleware');
const jobsController = require('../controllers/jobsController');
const jobsRouter = express.Router();

jobsRouter.get('/', auth, jobsController.getJobs)

jobsRouter.post('/', auth, jobsController.createJob)

jobsRouter.put('/:id', auth, jobsController.updateJob)

jobsRouter.delete('/:id', auth, jobsController.deleteJob)


module.exports = jobsRouter;