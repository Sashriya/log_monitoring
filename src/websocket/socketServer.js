import { WebSocketServer } from "ws";
import { parse } from "url";
import { verifyToken } from "../utils/jwt.js";
import { validateLogPath, logFileExists } from "../utils/pathValidator.js";
import { addClient, removeClient, readLastNLines } from "../services/logWatcher.js";

export function initWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: undefined });

  wss.on("connection", async (ws, req) => {
    const { pathname, query } = parse(req.url, true);

    const match = pathname.match(/^\/ws\/logs\/(.+)$/);
    if (!match) {
      _close(ws, 4000, "Invalid WebSocket path. Use /ws/logs/{fileName}");
      return;
    }

    const fileName = match[1];

    const token = query.token;
    if (!token) {
      _close(ws, 4001, "Missing token query parameter");
      return;
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      const msg = err.name === "TokenExpiredError" ? "Token expired" : "Invalid token";
      _close(ws, 4001, msg);
      return;
    }

    const { valid, fullPath, error } = validateLogPath(fileName);
    if (!valid) {
      _close(ws, 4002, error);
      return;
    }

    if (!logFileExists(fullPath)) {
      _close(ws, 4004, `Log file not found: ${fileName}`);
      return;
    }

    let lines = parseInt(query.lines, 10);
    if (isNaN(lines) || lines < 1) lines = 10;
    if (lines > 10000) lines = 10000;

    console.log(
      `[WS] Client connected: user=${decoded.email} file=${fileName} lines=${lines}`
    );

    _send(ws, { type: "connected", file: fileName, user: decoded.email });

    try {
      const initialLines = await readLastNLines(fullPath, lines);
      if (initialLines.length > 0) {
        _send(ws, { type: "snapshot", file: fileName, lines: initialLines });
      } else {
        _send(ws, { type: "snapshot", file: fileName, lines: [], message: "File is empty" });
      }
    } catch (err) {
      console.error("[WS] Error reading initial lines:", err.message);
      _send(ws, { type: "error", message: "Failed to read log file" });
      ws.close();
      return;
    }

    addClient(fullPath, ws);

    ws.on("close", (code) => {
      console.log(
        `[WS] Client disconnected: user=${decoded.email} file=${fileName} code=${code}`
      );
      removeClient(fullPath, ws);
    });

    ws.on("error", (err) => {
      console.error(`[WS] Socket error for ${fileName}:`, err.message);
      removeClient(fullPath, ws);
    });

    ws.on("message", () => {});
  });

  console.log("[WS] WebSocket server initialized");
  return wss;
}

function _send(ws, payload) {
  if (ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      console.error("[WS] Send error:", err.message);
    }
  }
}

function _close(ws, code, reason) {
  console.warn(`[WS] Closing connection: [${code}] ${reason}`);
  try {
    ws.send(JSON.stringify({ type: "error", code, message: reason }));
  } catch { }
  ws.close(code, reason);
}