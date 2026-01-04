const WebSocket = require("ws");
const { nanoid } = require("nanoid");

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

/**
 * room = { code, status, hostId, players: [{ id, name, ws }] }
 */
const rooms = new Map();

function send(ws, type, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data }));
  }
}

function broadcast(room, type, data) {
  room.players.forEach((p) => send(p.ws, type, data));
}

function makeRoomState(room) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    players: room.players.map((p) => ({ id: p.id, name: p.name })),
  };
}

function findRoomByWs(ws) {
  for (const room of rooms.values()) {
    const idx = room.players.findIndex((p) => p.ws === ws);
    if (idx !== -1) return { room, idx };
  }
  return null;
}

function createRoom(data, ws) {
  const code = nanoid(6).toUpperCase();
  const playerId = nanoid(10);
  const name = (data?.name || "Player").slice(0, 20);

  const room = {
    code,
    status: "lobby",
    hostId: playerId,
    players: [{ id: playerId, name, ws }],
  };

  rooms.set(code, room);

  send(ws, "created_room", { roomCode: code, playerId });
  broadcast(room, "room_state", makeRoomState(room));
}

function joinRoom(data, ws) {
  const code = (data?.roomCode || "").toUpperCase().trim();
  const name = (data?.name || "Player").slice(0, 20);

  const room = rooms.get(code);
  if (!room) return send(ws, "error", { message: "Room not found" });
  if (room.status !== "lobby") return send(ws, "error", { message: "Game already started" });
  if (room.players.length >= 4) return send(ws, "error", { message: "Room is full" });

  const playerId = nanoid(10);
  room.players.push({ id: playerId, name, ws });

  send(ws, "joined_room", { roomCode: code, playerId });
  broadcast(room, "room_state", makeRoomState(room));
}
function startGame(data, ws) {
  const code = (data?.roomCode || "").toUpperCase().trim();
  const room = rooms.get(code);
  if (!room) return send(ws, "error", { message: "Room not found" });

  // player đang gửi lệnh là ai?
  const player = room.players.find((p) => p.ws === ws);
  if (!player) return send(ws, "error", { message: "Not in this room" });

  // chỉ host mới được start
  if (player.id !== room.hostId) {
    return send(ws, "error", { message: "Only host can start" });
  }

  // tối thiểu 2 người
  if (room.players.length < 2) {
    return send(ws, "error", { message: "Need at least 2 players" });
  }

  // nếu đang playing rồi thì thôi
  if (room.status === "playing") {
    return send(ws, "error", { message: "Game already started" });
  }

  room.status = "playing";

  // báo cho tất cả
  broadcast(room, "room_state", makeRoomState(room));
  broadcast(room, "game_started", { roomCode: room.code });
}

function leaveRoom(ws) {
  const found = findRoomByWs(ws);
  if (!found) return;

  const { room, idx } = found;
  const leaving = room.players[idx];
  room.players.splice(idx, 1);

  // host rời => chuyển host
  if (room.hostId === leaving.id && room.players.length > 0) {
    room.hostId = room.players[0].id;
  }

  // phòng trống => xoá phòng
  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }

  broadcast(room, "room_state", makeRoomState(room));
}

wss.on("connection", (ws) => {
  send(ws, "hello", { message: "connected" });

  ws.on("message", (raw) => {
    const text = raw.toString();
    console.log("📩 RECEIVED:", text);

    let msg;
    try {
      msg = JSON.parse(text);
    } catch (e) {
      return send(ws, "error", { message: "Invalid JSON" });
    }

    const { type, data } = msg || {};
    if (!type) return send(ws, "error", { message: "Missing type" });

    if (type === "create_room") return createRoom(data, ws);
    if (type === "join_room") return joinRoom(data, ws);
    if (type === "start_game") return startGame(data, ws);

    return send(ws, "error", { message: `Unknown event: ${type}` });
  });

  ws.on("close", () => {
    leaveRoom(ws);
  });
});

console.log(`✅ Lobby server running: ws://localhost:${PORT}`);
