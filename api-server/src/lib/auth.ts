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

export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "ibpm-salt-2025").digest("hex");
}

export function generateTxHash(): string {
  return "0x" + crypto.randomBytes(32).toString("hex");
}

export function generateToken(userId: number): string {
  return Buffer.from(`${userId}:${Date.now()}:ibpm-secret-key`).toString("base64");
}

export function decodeToken(token: string): number | null {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const [userId] = decoded.split(":");
    const id = parseInt(userId);
    if (isNaN(id)) return null;
    return id;
  } catch {
    return null;
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return next();
  }
  const token = authHeader.slice(7);
  const userId = decodeToken(token);
  if (!userId) return next();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (user) {
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

export function canTeach(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!["teacher", "admin"].includes(req.user.role)) {
    res.status(403).json({ error: "Teacher or admin access required" });
    return;
  }
  next();
}
