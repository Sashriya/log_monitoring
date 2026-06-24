import path from "path";
import fs from "fs";

const LOG_DIR = path.resolve(process.env.LOG_DIR || "./logs");

export const validateLogPath = (fileName) => {
  if (!fileName || typeof fileName !== "string") {
    return { valid: false, error: "Filename is required" };
  }

  if (fileName.includes("\0")) {
    return { valid: false, error: "Invalid filename" };
  }

  if (
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("..") ||
    path.isAbsolute(fileName)
  ) {
    return { valid: false, error: "Path traversal detected" };
  }

  const fullPath = path.resolve(LOG_DIR, fileName);
  if (!fullPath.startsWith(LOG_DIR + path.sep) && fullPath !== LOG_DIR) {
    return { valid: false, error: "Access denied: path outside log directory" };
  }

  return { valid: true, fullPath };
};

export const logFileExists = (fullPath) => {
  try {
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
  } catch {
    return false;
  }
};

export const getLogDir = () => LOG_DIR;