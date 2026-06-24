/**
 * LogWatcher Service
 * ==================
 * Implements efficient real-time log file monitoring without third-party tailing libraries.
 */

import fs from "fs";

const POLL_INTERVAL = 1000;

/**
 * watchers: Map<string, WatcherEntry>
 *
 * WatcherEntry = {
 *   clients : Set<WebSocket>
 *   offset  : number
 *   buffer  : string
 *   inode   : number|null
 * }
 */
const watchers = new Map();

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Add a WebSocket client to a file's watcher.
 * @param {string}    filePath
 * @param {WebSocket} client
 */
export function addClient(filePath, client) {
  if (!watchers.has(filePath)) {
    _createWatcher(filePath);
  }
  watchers.get(filePath).clients.add(client);
  console.log(
    `[LogWatcher] Client added → ${filePath} (${watchers.get(filePath).clients.size} total)`
  );
}

/**
 * Remove a WebSocket client from a file's watcher.
 * @param {string}    filePath
 * @param {WebSocket} client
 */
export function removeClient(filePath, client) {
  const entry = watchers.get(filePath);
  if (!entry) return;

  entry.clients.delete(client);
  console.log(
    `[LogWatcher] Client removed ← ${filePath} (${entry.clients.size} remaining)`
  );

  if (entry.clients.size === 0) {
    _destroyWatcher(filePath);
  }
}

/**
 * Read the last N lines of a file without loading the entire file into memory.
 * @param {string} filePath
 * @param {number} n
 * @returns {Promise<string[]>}
 */
export async function readLastNLines(filePath, n) {
  return new Promise((resolve, reject) => {
    try {
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;

      if (fileSize === 0) return resolve([]);

      const CHUNK = 4096;
      let position = fileSize;
      let rawBuffer = "";
      let linesFound = 0;

      const fd = fs.openSync(filePath, "r");

      try {
        while (position > 0 && linesFound <= n) {
          const readSize = Math.min(CHUNK, position);
          position -= readSize;

          const buf = Buffer.alloc(readSize);
          fs.readSync(fd, buf, 0, readSize, position);

          rawBuffer = buf.toString("utf8") + rawBuffer;
          linesFound = (rawBuffer.match(/\n/g) || []).length;
        }
      } finally {
        fs.closeSync(fd);
      }

      const lines = rawBuffer
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .slice(-n);

      resolve(lines);
    } catch (err) {
      reject(err);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

function _createWatcher(filePath) {
  let initialSize = 0;
  let initialInode = null;

  try {
    const stat = fs.statSync(filePath);
    initialSize = stat.size;
    initialInode = stat.ino;
  } catch {
    // File may not exist yet
  }

  const entry = {
    clients: new Set(),
    offset: initialSize,
    buffer: "",
    inode: initialInode,
  };

  watchers.set(filePath, entry);

  fs.watchFile(filePath, { interval: POLL_INTERVAL, persistent: false }, (curr, prev) => {
    _onFileChange(filePath, curr, prev);
  });

  console.log(`[LogWatcher] Watcher created → ${filePath}`);
}

function _destroyWatcher(filePath) {
  fs.unwatchFile(filePath);
  watchers.delete(filePath);
  console.log(`[LogWatcher] Watcher destroyed → ${filePath}`);
}

function _onFileChange(filePath, curr, prev) {
  console.log("FILE CHANGED");
  console.log("Old Size:", prev.size);
  console.log("New Size:", curr.size);
  const entry = watchers.get(filePath);
  if (!entry || entry.clients.size === 0) return;

  if (curr.nlink === 0) {
    _broadcast(entry.clients, { type: "info", message: "Log file was deleted or moved." });
    return;
  }

  const newSize = curr.size;
  const newInode = curr.ino;

  if (entry.inode !== null && newInode !== entry.inode) {
    console.log(`[LogWatcher] File rotation detected: ${filePath}`);
    _broadcast(entry.clients, { type: "info", message: "Log file was rotated." });
    entry.offset = 0;
    entry.buffer = "";
    entry.inode = newInode;
  }

  if (newSize < entry.offset) {
    console.log(`[LogWatcher] File truncation detected: ${filePath}`);
    _broadcast(entry.clients, { type: "info", message: "Log file was truncated." });
    entry.offset = 0;
    entry.buffer = "";
  }

  if (newSize === entry.offset) return;

  const bytesToRead = newSize - entry.offset;
  const buf = Buffer.alloc(bytesToRead);

  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const bytesRead = fs.readSync(fd, buf, 0, bytesToRead, entry.offset);
    entry.offset += bytesRead;
  } catch (err) {
    console.error(`[LogWatcher] Read error on ${filePath}:`, err.message);
    return;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { }
    }
  }

  entry.inode = newInode;

  entry.buffer += buf.toString("utf8");

  const lastNewline = entry.buffer.lastIndexOf("\n");

  if (lastNewline === -1) return;

  const completeText = entry.buffer.slice(0, lastNewline);
  entry.buffer = entry.buffer.slice(lastNewline + 1);

  const newLines = completeText
    .split("\n")
    .filter((l) => l.trim().length > 0);

    console.log("Lines Found:", newLines);

  if (newLines.length > 0) {
    _broadcast(entry.clients, { type: "log", lines: newLines });
  }
}

function _broadcast(clients, payload) {
  const message = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === 1) {
      try {
        client.send(message);
      } catch (err) {
        console.error("[LogWatcher] Failed to send to client:", err.message);
        clients.delete(client);
      }
    } else {
      clients.delete(client);
    }
  }
  console.log("Broadcasting to", clients.size, "clients");
}