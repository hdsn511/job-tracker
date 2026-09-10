const express = require('express');
const multer = require('multer');
const auth = require('../middleware/authMiddleware');
const inboundController = require('../controllers/inboundController');

const inboundRouter = express.Router();

// Mailgun posts multipart/form-data (text fields, plus attachment parts we
// don't care about). memoryStorage with no size limit config beyond
// multer's own defaults is fine here -- attachment files are parsed and
// discarded, never read from req.files.
const upload = multer({ storage: multer.memoryStorage() });

inboundRouter.get('/status', auth, inboundController.getInboundStatus);
inboundRouter.post('/setup', auth, inboundController.setupInboundAddress);

// No auth middleware -- this is Mailgun's webhook, not a logged-in user.
// Authenticity comes from verifyMailgunSignature() inside the controller.
inboundRouter.post('/email', upload.any(), inboundController.receiveInboundEmail);

module.exports = inboundRouter;
