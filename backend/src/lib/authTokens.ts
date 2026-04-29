import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET env var is required");

export interface TokenPayload {
    sub: string;   // user id
    email: string;
}

export function signToken(payload: TokenPayload): string {
    return jwt.sign(payload, SECRET!, { expiresIn: "30d" });
}

export function verifyToken(token: string): TokenPayload {
    return jwt.verify(token, SECRET!) as TokenPayload;
}
