import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'scaleup-secret';

/**
 * Express middleware — verifies Bearer JWT and attaches `req.userId`.
 */
export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization header required' });
  }

  try {
    const token   = header.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId    = payload.userId;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}
