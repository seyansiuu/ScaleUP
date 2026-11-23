import { ZodError } from 'zod';

/**
 * Central Express error handler.
 * Maps known error types to appropriate HTTP status codes.
 */
export function errorHandler(err, _req, res, _next) {
  console.error('[ScaleUp Error]', err.message);

  // Zod validation errors → 400
  if (err instanceof ZodError) {
    return res.status(400).json({
      message: 'Validation error',
      errors: err.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  // Domain / business-logic errors
  const domainErrors = {
    'Startup not found':                          404,
    'Unauthorized':                                403,
    'Startup is not active':                       409,
    'Cannot advance turn: startup is not active':  409,
  };

  for (const [msg, status] of Object.entries(domainErrors)) {
    if (err.message === msg) {
      return res.status(status).json({ message: msg });
    }
  }

  // Prisma unique-constraint violation
  if (err.code === 'P2002') {
    return res.status(409).json({ message: 'A record with that key already exists' });
  }

  // Fallback
  res.status(500).json({ message: 'Internal server error' });
}
