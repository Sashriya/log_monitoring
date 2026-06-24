import "dotenv/config";
import http from "http";
import app from "./src/app.js";
import connectDB from "./src/config/db.js";
import { initWebSocket } from "./src/websocket/socketServer.js";

const PORT = process.env.PORT || 5000;

connectDB();

const server = http.createServer(app);

initWebSocket(server);

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🔌 WebSocket available at ws://localhost:${PORT}/ws/logs/{file}`);
  console.log(`📁 Monitoring log directory: ${process.env.LOG_DIR || "./logs"}`);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("\nSIGINT received. Shutting down gracefully...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});