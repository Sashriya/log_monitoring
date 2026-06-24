import fs from "fs";
import path from "path";
import { validateLogPath, logFileExists, getLogDir } from "../utils/pathValidator.js";
import { readLastNLines } from "../services/logWatcher.js";

export const listLogs = (req, res, next) => {
  try {
    const logDir = getLogDir();

    if (!fs.existsSync(logDir)) {
      return res.json([]);
    }

    const files = fs
      .readdirSync(logDir)
      .filter((f) => {
        try {
          return (
            f.endsWith(".log") &&
            fs.statSync(path.join(logDir, f)).isFile()
          );
        } catch {
          return false;
        }
      });

    res.json(files);
  } catch (err) {
    next(err);
  }
};

export const tailLog = async (req, res, next) => {
  try {
    const { fileName } = req.params;
    const lines = parseInt(req.query.lines, 10) || 10;

    if (lines < 1 || lines > 10000) {
      return res.status(400).json({ error: "lines must be between 1 and 10000" });
    }

    const { valid, fullPath, error } = validateLogPath(fileName);
    if (!valid) {
      return res.status(400).json({ error });
    }

    if (!logFileExists(fullPath)) {
      return res.status(404).json({ error: `Log file not found: ${fileName}` });
    }

    const lastLines = await readLastNLines(fullPath, lines);

    res.json({
      file: fileName,
      lines: lastLines,
      count: lastLines.length,
    });
  } catch (err) {
    next(err);
  }
};