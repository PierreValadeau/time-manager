import type { RequestHandler } from 'express';
import { z } from 'zod';
import AppError from '../errors/AppError';

type Schemas = {
  body?: z.ZodType;
  params?: z.ZodType;
  query?: z.ZodType;
};

const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    const issues: z.core.$ZodIssue[] = [];
    const parsed: Partial<Record<keyof Schemas, unknown>> = {};

    for (const key of ['body', 'params', 'query'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (result.success) parsed[key] = result.data;
      else issues.push(...result.error.issues);
    }

    if (issues.length > 0) {
      const details = issues.map(issue => ({
        field: issue.path.join('.'),
        issue: issue.code,
      }));
      const message = details[0].field
        ? `Le champ ${details[0].field} est invalide`
        : 'Requête invalide';
      next(new AppError(400, 'VALIDATION_ERROR', message, details));
      return;
    }

    // On remplace les entrées par les versions validées (valeurs par défaut, coercions...)
    if ('body' in parsed) req.body = parsed.body;
    if ('params' in parsed) req.params = parsed.params as typeof req.params;
    // Express 5 : req.query est un getter, on ne peut pas l'assigner directement
    if ('query' in parsed) {
      Object.defineProperty(req, 'query', { value: parsed.query, writable: true });
    }
    next();
  };

export default validate;
