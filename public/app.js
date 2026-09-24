const menu = document.querySelector("#menu");
const mainMenu = document.querySelector("#main-menu");
const joinMenu = document.querySelector("#join-menu");
const joinCodeInput = document.querySelector("#join-code");
const menuError = document.querySelector("#menu-error");
const game = document.querySelector("#game");
const arena = document.querySelector("#arena");
const roomCodeLabel = document.querySelector("#room-code-label");
const connectionLabel = document.querySelector("#connection-label");
const playerCountLabel = document.querySelector("#player-count");

let socket = null;
let myId = null;
let arenaConfig = { width: 960, height: 600, radius: 22 };
let players = new Map();
let keys = new Set();
let myPosition = null;
let lastFrame = performance.now();
let lastSent = 0;

function setError(message = "") {
  menuError.textContent = message;
}

function normalizeCode(value) {
  return value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
}

function makeWsUrl(code) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/api/room/${code}`;
}

async function startGame() {
  setError();
  const button = document.querySelector("#start-game");
  button.disabled = true;
  button.textContent = "Creating…";

  try {
    const response = await fetch("/api/create", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not create session.");
    connectToRoom(data.code);
  } catch (error) {
    setError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Start game";
  }
}

async function joinGame() {
  setError();
  const code = normalizeCode(joinCodeInput.value);
  joinCodeInput.value = code;

  if (code.length !== 6) {
    setError("Enter a 6-character session code.");
    return;
  }

  const button = document.querySelector("#join-submit");
  button.disabled = true;
  button.textContent = "Joining…";

  try {
    const response = await fetch(`/api/room/${code}/status`);
    const data = await response.json().catch(() => ({}));
    if (response.status === 404 || !data.exists) throw new Error("Session not found.");
    if (!response.ok) throw new Error(data.error || "Could not check session.");
    if (data.full) throw new Error("That session is full.");
    connectToRoom(code);
  } catch (error) {
    setError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Join";
  }
}

function connectToRoom(code) {
  if (socket) socket.close();

  roomCodeLabel.textContent = code;
  connectionLabel.textContent = "Connecting…";
  socket = new WebSocket(makeWsUrl(code));

  socket.addEventListener("open", () => {
    connectionLabel.textContent = "Connected";
    menu.hidden = true;
    game.hidden = false;
    arena.focus();
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "welcome") {
      myId = message.id;
      arenaConfig = message.arena;
      applyState(message.players);
      const me = players.get(myId);
      if (me) myPosition = { x: me.x, y: me.y };
      return;
    }

    if (message.type === "state") {
      applyState(message.players);
    }
  });

  socket.addEventListener("close", () => {
    connectionLabel.textContent = "Disconnected";
    keys.clear();
  });

  socket.addEventListener("error", () => {
    connectionLabel.textContent = "Connection error";
  });
}

function applyState(nextPlayers) {
  const ids = new Set(nextPlayers.map((player) => player.id));

  for (const [id, player] of players) {
    if (!ids.has(id)) {
      player.element.remove();
      players.delete(id);
    }
  }

  for (const state of nextPlayers) {
    let player = players.get(state.id);
    if (!player) {
      const element = document.createElement("div");
      element.className = "blob";
      element.dataset.id = state.id;
      arena.appendChild(element);
      player = { ...state, element };
      players.set(state.id, player);
    }

    if (state.id !== myId || !myPosition) {
      player.x = state.x;
      player.y = state.y;
    }
    player.hue = state.hue;
    player.element.style.setProperty("--blob-hue", state.hue);
    player.element.classList.toggle("me", state.id === myId);
  }

  playerCountLabel.textContent = `${nextPlayers.length}/6 players`;
  renderPlayers();
}

function renderPlayers() {
  for (const [id, player] of players) {
    const position = id === myId && myPosition ? myPosition : player;
    const xPercent = (position.x / arenaConfig.width) * 100;
    const yPercent = (position.y / arenaConfig.height) * 100;
    player.element.style.left = `${xPercent}%`;
    player.element.style.top = `${yPercent}%`;
  }
}

function gameLoop(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  if (myPosition && socket?.readyState === WebSocket.OPEN) {
    let dx = 0;
    let dy = 0;
    if (keys.has("w")) dy -= 1;
    if (keys.has("s")) dy += 1;
    if (keys.has("a")) dx -= 1;
    if (keys.has("d")) dx += 1;

    if (dx || dy) {
      const length = Math.hypot(dx, dy);
      const speed = 240;
      dx /= length;
      dy /= length;

      myPosition.x = Math.max(arenaConfig.radius, Math.min(arenaConfig.width - arenaConfig.radius, myPosition.x + dx * speed * dt));
      myPosition.y = Math.max(arenaConfig.radius, Math.min(arenaConfig.height - arenaConfig.radius, myPosition.y + dy * speed * dt));
      renderPlayers();

      if (now - lastSent >= 40) {
        socket.send(JSON.stringify({ type: "move", x: myPosition.x, y: myPosition.y }));
        lastSent = now;
      }
    }
  }

  requestAnimationFrame(gameLoop);
}

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (["w", "a", "s", "d"].includes(key) && !game.hidden) {
    event.preventDefault();
    keys.add(key);
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

window.addEventListener("blur", () => keys.clear());

joinCodeInput.addEventListener("input", () => {
  joinCodeInput.value = normalizeCode(joinCodeInput.value);
});
joinCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinGame();
});

document.querySelector("#start-game").addEventListener("click", startGame);
document.querySelector("#show-join").addEventListener("click", () => {
  setError();
  mainMenu.hidden = true;
  joinMenu.hidden = false;
  joinCodeInput.focus();
});
document.querySelector("#join-submit").addEventListener("click", joinGame);
document.querySelector("#join-back").addEventListener("click", () => {
  setError();
  joinMenu.hidden = true;
  mainMenu.hidden = false;
});
document.querySelector("#copy-code").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomCodeLabel.textContent);
    document.querySelector("#copy-code").textContent = "Copied";
    setTimeout(() => (document.querySelector("#copy-code").textContent = "Copy"), 900);
  } catch {
    // Clipboard permission can be unavailable in some browsers.
  }
});
document.querySelector("#leave-game").addEventListener("click", () => location.reload());

requestAnimationFrame(gameLoop);
