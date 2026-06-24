import User from "../models/User.js";
import { verifyToken, extractBearerToken } from "../utils/jwt.js";

export const protect = async (req, res, next) => {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      return res.status(401).json({ error: "No token provided. Authorization denied." });
    }

    const decoded = verifyToken(token);

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: "User no longer exists" });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired. Please log in again." });
    }
    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid token" });
    }
    next(err);
  }
};