import { Request, Response, NextFunction } from 'express';
import { Action } from './permissions';
import { can, isUserActive, type AuthenticatedUser } from './policies';
import { authenticateSessionToken } from './service';
import { getUserById } from '../users/repository';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      sessionToken?: string;
    }
  }
}

function bearerToken(req: Request): string | undefined {
  const headers = (req as any).headers ?? {};
  const authorization = headers.authorization;
  const authorizationValue = Array.isArray(authorization) ? authorization[0] : authorization;
  if (authorizationValue?.startsWith('Bearer ')) return authorizationValue.slice('Bearer '.length).trim();
  const sessionHeader = headers['x-session-token'];
  return Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
}

export async function loadUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req);
  if (token) {
    const authenticated = await authenticateSessionToken(token);
    if (authenticated) {
      req.user = authenticated.user;
      (req as any).sessionToken = token;
      return next();
    }
  }

  // Development/test compatibility for in-process callers that have not adopted session tokens yet.
  const legacyUserId = ((req as any).headers ?? {})['x-user-id'];
  const userId = Array.isArray(legacyUserId) ? legacyUserId[0] : legacyUserId;
  if (userId) req.user = (await getUserById(userId)) ?? undefined;
  next();
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
