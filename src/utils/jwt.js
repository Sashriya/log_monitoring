import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export const generateToken = (payload) => {
  if (!JWT_SECRET) throw new Error("JWT_SECRET is not configured");
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

export const verifyToken = (token) => {
  if (!JWT_SECRET) throw new Error("JWT_SECRET is not configured");
  return jwt.verify(token, JWT_SECRET);
};

export const extractBearerToken = (authHeader) => {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim();
};