const express = require('express');
const auth = require('../middleware/authMiddleware');
const gmailController = require('../controllers/gmailController');
const syncController = require('../controllers/syncController');
const gmailRouter = express.Router();

gmailRouter.get('/connect', auth, gmailController.startGmailConnect);

// No auth middleware — Google redirects the browser here directly with no
// Authorization header. Identity comes from the signed `state` param.
gmailRouter.get('/callback', gmailController.handleGmailCallback);

gmailRouter.get('/status', auth, gmailController.getGmailStatus);

gmailRouter.delete('/disconnect', auth, gmailController.disconnectGmail);

gmailRouter.post('/sync', auth, syncController.runSync);

module.exports = gmailRouter;
