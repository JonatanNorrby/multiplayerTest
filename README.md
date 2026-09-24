# MultiplayerTest

A minimal multiplayer browser tech demo hosted on Cloudflare Workers.

## Demo flow

- **Start game** creates a six-character session code and opens a room.
- **Join game** accepts that code and joins the existing room.
- Every player appears as a colored blob.
- Move with **WASD**.
- Each room is capped at **6 players**, ready for the planned 3v3 format.

## Architecture

- `public/` — static browser client served by Workers Static Assets.
- `src/index.js` — Worker API and a `GameRoom` Durable Object.
- Each session code maps to one Durable Object.
- Player positions are synchronized over WebSockets using Cloudflare's WebSocket Hibernation API.

## Cloudflare deployment

The repository is intended to be connected to Cloudflare Workers Builds.

- Build command: none required
- Deploy command: `npx wrangler deploy`
- Version command (if Cloudflare asks): `npx wrangler versions upload`

Every push to the production branch can then deploy automatically.

## Local development

```bash
npm install
npm run dev
```
