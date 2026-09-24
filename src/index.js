import { DurableObject } from "cloudflare:workers";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const MAX_PLAYERS = 6;
const ARENA_WIDTH = 960;
const ARENA_HEIGHT = 600;
const PLAYER_RADIUS = 22;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function roomCode() {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(
    bytes,
    (value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length],
  ).join("");
}

function validRoomCode(code) {
  return new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`).test(code);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/api/create") {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const code = roomCode();
        const room = env.GAME_ROOM.getByName(code);
        const response = await room.fetch("https://room.internal/create", {
          method: "POST",
        });

        if (response.status === 201) {
          return json({ code }, 201);
        }
      }

      return json({ error: "Could not allocate a room code. Try again." }, 503);
    }

    const roomMatch = url.pathname.match(
      /^\/api\/room\/([A-Z2-9]{6})(\/status)?$/,
    );

    if (roomMatch) {
      const code = roomMatch[1];

      if (!validRoomCode(code)) {
        return json({ error: "Invalid room code." }, 400);
      }

      const room = env.GAME_ROOM.getByName(code);

      if (roomMatch[2] === "/status") {
        return room.fetch("https://room.internal/status");
      }

      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return json({ error: "WebSocket upgrade required." }, 426);
      }

      return room.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (
      request.method === "POST" &&
      url.hostname === "room.internal" &&
      url.pathname === "/create"
    ) {
      const createdAt = await this.ctx.storage.get("createdAt");

      if (createdAt) {
        return json({ error: "Room already exists." }, 409);
      }

      await this.ctx.storage.put("createdAt", Date.now());
      return json({ ok: true }, 201);
    }

    if (url.hostname === "room.internal" && url.pathname === "/status") {
      const createdAt = await this.ctx.storage.get("createdAt");
      const players = this.ctx.getWebSockets().length;

      return json(
        {
          exists: Boolean(createdAt),
          players,
          full: players >= MAX_PLAYERS,
        },
        createdAt ? 200 : 404,
      );
    }

    const createdAt = await this.ctx.storage.get("createdAt");

    if (!createdAt) {
      return json({ error: "Room not found." }, 404);
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "WebSocket upgrade required." }, 426);
    }

    if (this.ctx.getWebSockets().length >= MAX_PLAYERS) {
      return json({ error: "Room is full." }, 409);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const player = {
      id: crypto.randomUUID(),
      x: Math.round(ARENA_WIDTH / 2 + (Math.random() - 0.5) * 240),
      y: Math.round(ARENA_HEIGHT / 2 + (Math.random() - 0.5) * 160),
      hue: Math.floor(Math.random() * 360),
    };

    server.serializeAttachment(player);
    this.ctx.acceptWebSocket(server);

    server.send(
      JSON.stringify({
        type: "welcome",
        id: player.id,
        arena: {
          width: ARENA_WIDTH,
          height: ARENA_HEIGHT,
          radius: PLAYER_RADIUS,
        },
        players: this.players(),
      }),
    );

    this.broadcastState();

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string") return;

    let data;

    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    if (data.type !== "move") return;

    const player = ws.deserializeAttachment();
    if (!player) return;

    const x = Number(data.x);
    const y = Number(data.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    player.x = Math.max(
      PLAYER_RADIUS,
      Math.min(ARENA_WIDTH - PLAYER_RADIUS, x),
    );
    player.y = Math.max(
      PLAYER_RADIUS,
      Math.min(ARENA_HEIGHT - PLAYER_RADIUS, y),
    );

    ws.serializeAttachment(player);
    this.broadcastState();
  }

  webSocketClose() {
    this.broadcastState();
  }

  webSocketError(ws) {
    try {
      ws.close(1011, "WebSocket error");
    } catch {
      // The socket may already be closed.
    }

    this.broadcastState();
  }

  players() {
    return this.ctx
      .getWebSockets()
      .map((ws) => ws.deserializeAttachment())
      .filter(Boolean);
  }

  broadcastState() {
    const sockets = this.ctx.getWebSockets();
    const payload = JSON.stringify({
      type: "state",
      players: this.players(),
    });

    for (const socket of sockets) {
      try {
        socket.send(payload);
      } catch {
        // Ignore sockets that are in the process of closing.
      }
    }
  }
}
