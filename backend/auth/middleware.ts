import { Request, Response, NextFunction } from 'express';
import { Action } from './permissions';
import { can, isUserActive, type AuthenticatedUser } from './policies';
import { getUserById } from '../users/repository';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  next();
}

export async function requireActiveUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const latest = await getUserById(req.user.id);
  if (!latest || !isUserActive(latest)) {
    res.status(403).json({ error: 'User account is inactive.' });
    return;
  }

  req.user = latest;
  next();
}

export function authorize(action: Action) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    if (!can(req.user, action)) {
      res.status(403).json({ error: `Missing permission: ${action}` });
      return;
    }

    next();
  };
}
