const jwt = require('jsonwebtoken');

// The session token lives in an httpOnly cookie, not a header the client
// can read — an XSS bug on the frontend can't exfiltrate it and replay it
// elsewhere the way a localStorage-held bearer token could.
const authMiddleware = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = authMiddleware;