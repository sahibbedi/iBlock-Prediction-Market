import { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
  cohortId: number | null;
  giesBalance: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export { hashPassword, generateToken } from "./security.js";
import { decodeToken, canTrade } from "./security.js";
export function generateTxHash(): string { return "0x" + crypto.randomBytes(32).toString("hex"); }
export const observer = { id: 0, username: "observer", displayName: "Observer", role: "observer", cohortId: null, giesBalance: "0" };

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET") req.user = observer;
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return next();
  }
  const token = authHeader.slice(7);
  const claims = decodeToken(token);
  if (!claims) return next();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.sub)).limit(1);
  if (user && user.sessionVersion === claims.version) {
    req.user = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      cohortId: user.cohortId,
      giesBalance: user.giesBalance,
    };
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Committee access required" });
    return;
  }
  next();
}

export function requireParticipant(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !canTrade(req.user.role)) return void res.status(403).json({ error: "An enrolled participant account is required" });
  next();
}
export function requireActive(req: Request, res: Response, next: NextFunction) {
  void (async () => {
    const [user] = req.user ? await db.select().from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1) : [];
    if (!user?.active) return void res.status(403).json({ error: "Membership is inactive" });
    next();
  })().catch(next);
}
