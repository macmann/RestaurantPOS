declare module 'express' {
  export interface Request {
    user?: import('../../backend/auth/policies').AuthenticatedUser;
  }

  export interface Response {
    status(code: number): this;
    json(body: unknown): this;
  }

  export interface NextFunction {
    (error?: unknown): void;
  }
}
