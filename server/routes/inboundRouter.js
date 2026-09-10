const express = require('express');
const multer = require('multer');
const auth = require('../middleware/authMiddleware');
const inboundController = require('../controllers/inboundController');

const inboundRouter = express.Router();

// Mailgun's route forward() action posts multipart/form-data only when the
// message has attachments -- a plain email with none (a Gmail forwarding
// confirmation, most application confirmations) comes as
// application/x-www-form-urlencoded instead. Each parser no-ops when the
// content-type doesn't match its own, so stacking both handles either case;
// relying on multer alone left req.body empty for the urlencoded case,
// which made every signature field read undefined and fail the check
// closed regardless of whether the signing key was actually right.
const urlencoded = express.urlencoded({ extended: true });
const upload = multer({ storage: multer.memoryStorage() });

inboundRouter.get('/status', auth, inboundController.getInboundStatus);
inboundRouter.post('/setup', auth, inboundController.setupInboundAddress);

// No auth middleware -- this is Mailgun's webhook, not a logged-in user.
// Authenticity comes from verifyMailgunSignature() inside the controller.
inboundRouter.post('/email', urlencoded, upload.any(), inboundController.receiveInboundEmail);

module.exports = inboundRouter;
