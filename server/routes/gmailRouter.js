const express = require('express');
const auth = require('../middleware/authMiddleware');
const gmailController = require('../controllers/gmailController');
const gmailRouter = express.Router();

gmailRouter.get('/connect', auth, gmailController.startGmailConnect);

// No auth middleware — Google redirects the browser here directly with no
// Authorization header. Identity comes from the signed `state` param.
gmailRouter.get('/callback', gmailController.handleGmailCallback);

gmailRouter.get('/status', auth, gmailController.getGmailStatus);

module.exports = gmailRouter;
