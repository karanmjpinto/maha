import bcrypt from "bcrypt";

const ROUNDS = 12;

export function hashPassword(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, ROUNDS);
}

export function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
}
