# LogMonitor — Real-Time Log Monitoring Service

A backend service (with optional React dashboard) that lets authenticated clients monitor server-side log files in real time over WebSockets — a simplified authenticated `tail -f`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Framework | Express.js |
| Database | MongoDB + Mongoose |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Real-time | WebSocket (ws) |
| Frontend | React 18, React Router v6 |

---

## Project Structure

```
log-monitor/
├── server.js                   # Entry point — creates HTTP + WS servers
├── src/
│   ├── app.js                  # Express app, routes, middleware
│   ├── config/
│   │   └── db.js               # MongoDB connection
│   ├── models/
│   │   └── User.js             # User schema (password hashed at rest)
│   ├── routes/
│   │   ├── authRoutes.js       # /auth/*
│   │   └── logRoutes.js        # /logs/*
│   ├── controllers/
│   │   ├── authController.js   # register, login, getMe
│   │   └── logController.js    # listLogs, tailLog
│   ├── middleware/
│   │   └── authMiddleware.js   # JWT protect middleware
│   ├── websocket/
│   │   └── socketServer.js     # WS upgrade handler + client lifecycle
│   ├── services/
│   │   └── logWatcher.js       # Core tailing logic (offset, broadcast, edge cases)
│   └── utils/
│       ├── jwt.js              # sign / verify / extract helpers
│       └── pathValidator.js    # Path traversal protection
├── logs/
│   ├── app.log
│   ├── error.log
│   └── payment.log
├── frontend/                   # React dashboard (optional)
│   └── src/
│       ├── context/AuthContext.js
│       ├── hooks/useLogStream.js
│       ├── pages/{Login,Register,Dashboard}Page.js
│       └── components/ProtectedRoute.js
├── .env.example
└── package.json
```

---

## Installation

### Prerequisites
- Node.js ≥ 18
- MongoDB (local or Atlas)

### Backend

```bash
# 1. Clone and enter the project
git clone <repo-url>
cd log-monitor

# 2. Install dependencies
npm install

# 3. Copy and configure environment variables
cp .env.example .env
# Edit .env with your MONGO_URI and JWT_SECRET

# 4. Start the server
npm run dev        # development (nodemon)
npm start          # production
```

### Frontend (optional)

```bash
cd frontend
npm install
npm start          # opens http://localhost:3000
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | HTTP server port |
| `MONGO_URI` | `mongodb://localhost:27017/logmonitor` | MongoDB connection string |
| `JWT_SECRET` | — | **Required.** Secret for signing JWTs |
| `JWT_EXPIRES_IN` | `7d` | JWT expiry duration |
| `LOG_DIR` | `./logs` | Directory containing monitored log files |

---

## API Documentation

All protected routes require the header:
```
Authorization: Bearer <token>
```

### POST /auth/register
Create a new user account.

**Request body:**
```json
{ "username": "alice", "email": "alice@example.com", "password": "secret123" }
```

**Response `201`:**
```json
{ "message": "User Registered", "user": { "id": "...", "username": "alice", "email": "alice@example.com" } }
```

---

### POST /auth/login
Authenticate and receive a JWT.

**Request body:**
```json
{ "email": "alice@example.com", "password": "secret123" }
```

**Response `200`:**
```json
{ "token": "eyJhbGc...", "user": { "id": "...", "username": "alice", "email": "alice@example.com" } }
```

---

### GET /auth/me *(protected)*
Returns the authenticated user's profile.

**Response `200`:**
```json
{ "id": "...", "username": "alice", "email": "alice@example.com", "createdAt": "..." }
```

---

### GET /logs *(protected)*
List all `.log` files in `LOG_DIR`.

**Response `200`:**
```json
["app.log", "error.log", "payment.log"]
```

---

### GET /logs/:fileName/tail?lines=10 *(protected)*
Return the last N lines of a log file.

**Example:** `GET /logs/app.log/tail?lines=5`

**Response `200`:**
```json
{
  "file": "app.log",
  "lines": ["line 8", "line 9", "line 10", "line 11", "line 12"],
  "count": 5
}
```

**Rejected paths (400):**
- `../../.env`
- `../secrets.txt`
- `/etc/passwd`

---

### GET /health
Server health check. No auth required.

**Response `200`:**
```json
{ "status": "healthy", "timestamp": "2024-01-15T08:00:00.000Z", "uptime": 1234.5 }
```

---

## WebSocket Usage

**Endpoint:**
```
ws://localhost:5000/ws/logs/{fileName}?lines=10&token=<jwt>
```

**Example:**
```
ws://localhost:5000/ws/logs/app.log?lines=10&token=eyJhbGc...
```

### Message format (server → client)

All messages are JSON-encoded:

```jsonc
// On successful connection
{ "type": "connected", "file": "app.log", "user": "alice@example.com" }

// Initial snapshot (last N lines)
{ "type": "snapshot", "file": "app.log", "lines": ["line 1", ..., "line 10"] }

// New lines as they appear
{ "type": "log", "lines": ["new log line"] }

// Informational events (truncation, rotation)
{ "type": "info", "message": "Log file was truncated." }

// Errors
{ "type": "error", "code": 4001, "message": "Invalid token" }
```

### WebSocket close codes

| Code | Meaning |
|------|---------|
| 4000 | Invalid WebSocket path |
| 4001 | Missing or invalid JWT |
| 4002 | Path traversal / invalid filename |
| 4004 | Log file not found |

### JavaScript client example

```javascript
const token = "eyJhbGc...";
const ws = new WebSocket(`ws://localhost:5000/ws/logs/app.log?lines=20&token=${token}`);

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "snapshot") {
    console.log("Initial lines:", msg.lines);
  } else if (msg.type === "log") {
    msg.lines.forEach(line => console.log("[NEW]", line));
  }
};
```

---

## Architecture

```
Client
  │
  ├── POST /auth/register → Hash password → Store in MongoDB
  ├── POST /auth/login    → Compare hash  → Return JWT
  │
  ▼
JWT Token (sent in Authorization header or ?token= for WS)
  │
  ▼
Protected APIs / WebSocket endpoint
  │
  ▼
LogWatcher Service (singleton per file)
  │
  ├── readLastNLines()  — reverse-scan, no full-file load
  ├── fs.watchFile()    — one watcher per file (not per client)
  ├── Offset tracking   — reads only bytes past last position
  ├── Broadcast         — sends to all clients in one pass
  └── Edge cases        → truncation, rotation, partial lines
  │
  ▼
logs/*.log
```

### Key design: one watcher per file

```
watchers = Map {
  "app.log" → {
    clients : Set { wsA, wsB, wsC },  ← all clients sharing one watcher
    offset  : 20480,                  ← last byte read
    buffer  : "",                     ← incomplete line buffer
    inode   : 123456                  ← for rotation detection
  }
}
```

When the first client connects to a file, the watcher is created. When the last client disconnects, `fs.unwatchFile()` is called and the entry is removed.

---

## Edge Cases Handled

| Edge case | Behaviour |
|-----------|-----------|
| **Large files** | `readLastNLines` reads fixed-size chunks backwards; never loads the full file |
| **Offset tracking** | `offset` starts at `fileSize` on connection; only bytes past that position are sent |
| **File truncation** | Detected when `newSize < offset`; offset resets to 0 |
| **Partial line writes** | Incomplete text is held in `buffer` until a `\n` arrives |
| **Multiple clients** | One `fs.watchFile` watcher; new content is broadcast to all clients in a single pass |
| **File rotation** | Detected by inode change; offset resets to 0 and the new file is streamed from the start. Documented in README as a best-effort approach (no `SIGHUP` listener) |
| **Path traversal** | All filenames are resolved with `path.resolve()` and checked to start with `LOG_DIR` |

### Partial line write example
```
Poll 1:  buffer = "ERROR: Payment"         ← no newline yet, nothing sent
Poll 2:  buffer = "ERROR: Payment Failed\n" ← newline arrived, sent + buffer cleared
```

### File rotation (documented behaviour)
If the log file is renamed (`app.log` → `app.log.1`) and a new `app.log` is created, the inode change is detected on the next poll (within `POLL_INTERVAL` ms = 1 second). The offset resets and the new file is streamed from byte 0.

---

## Assumptions

1. Log files are UTF-8 encoded text files.
2. Lines are newline (`\n`) delimited.
3. All monitored files reside in `LOG_DIR`; subdirectory access is blocked by the path validator.
4. The WebSocket token is passed as a query parameter (standard practice when custom headers are not settable by the client).
5. A polling interval of 1 second is acceptable latency for near-real-time streaming.

---

## Future Improvements

- [ ] Refresh token support
- [ ] Role-based access control (restrict which users can view which files)
- [ ] `inotify`/`kqueue`-based watching (replace polling with native kernel events)
- [ ] Log search endpoint (`GET /logs/:fileName/search?q=ERROR`)
- [ ] Log line timestamps in structured JSON format
- [ ] Docker + Docker Compose setup
- [ ] Rate limiting on auth endpoints
- [ ] Cluster mode with Redis pub/sub for multi-instance broadcasting
