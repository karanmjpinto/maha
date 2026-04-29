import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/authTokens";

export async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ")) {
        res.status(401).json({ detail: "Missing or invalid Authorization header" });
        return;
    }
    const token = auth.slice(7).trim();
    try {
        const payload = verifyToken(token);
        res.locals.userId = payload.sub;
        res.locals.userEmail = payload.email.toLowerCase();
        res.locals.token = token;
        next();
    } catch {
        res.status(401).json({ detail: "Invalid or expired token" });
    }
}
