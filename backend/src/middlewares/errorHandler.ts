import type { ErrorRequestHandler } from 'express';
import AppError from '../errors/AppError';

const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // Réponse déjà partiellement envoyée : on laisse Express couper la connexion
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details && { details: err.details }),
      },
    });
    return;
  }

  // Erreurs client levées par express.json() : JSON malformé, corps trop gros, charset non supporté…
  if (err?.expose === true && err.status >= 400 && err.status < 500) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Le corps de la requête est invalide',
      },
    });
    return;
  }

  // Erreur imprévue : détail dans les logs serveur, rien de sensible au client
  console.error(err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur' },
  });
};

export default errorHandler;
