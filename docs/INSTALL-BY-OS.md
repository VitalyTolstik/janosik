# Running Janosik — macOS, Windows 11 and Linux

Two ways to run Janosik:

| | **Docker (recommended)** | **From source (for development)** |
| --- | --- | --- |
| What it is | Prebuilt container: whole app (API + UI) + PostgreSQL + Redis | UI and API development servers with PostgreSQL |
| You need | Docker Desktop / Docker Engine | Node.js 22.17+, npm |
| Best for | Running Janosik, including self-hosting | Developing Janosik |

The released Docker images target Linux `amd64` and `arm64`; Docker Desktop runs them on macOS and Windows. There are no standalone `.exe` or `.dmg` installers. Version v0.1.1 was tested on WSL and in Linux CI on both architectures.

Choose the option that fits your setup. For a **server** (VPS), see the
[self-hosting guide](./SELF-HOSTING.md). This page covers running Janosik on
your own computer.

---

## macOS

### Docker (recommended)

1. Install Docker Desktop (Apple Silicon or Intel) — or Colima if you prefer a
   lighter CLI-only setup:

   ```bash
   brew install --cask docker          # Docker Desktop
   # …or, no GUI:
   brew install colima docker docker-compose && colima start
   ```

   Launch Docker Desktop once (whale icon in the menu bar) and wait until it
   says "Docker Desktop is running".

2. With `curl` and OpenSSL installed, run the [local installer](./SELF-HOSTING.md) in Terminal. It opens `http://localhost:3210/app/` and generates the configuration.

The published image supports `arm64` and `amd64`. Version v0.1.1 has not been separately tested on a physical Mac.

### From source

```bash
brew install node@24            # or: brew install nvm && nvm install   # .nvmrc pins 24
git clone https://github.com/VitalyTolstik/janosik.git
cd janosik
npm install
npm run dev                     # → http://localhost:5173 (server mode: sign in / register)
```

`npm run dev` starts the UI in **server mode**: it talks to the API and shows a
sign-in screen, so you also need the dev database and API — see
[From source, all platforms](#from-source-all-platforms) below. The marketing
site is a separate dev server (`npm run dev:site`, port 4321).

---

## Windows 11

Docker Desktop for Windows uses **WSL2**. We recommend running the commands
from an Ubuntu WSL2 shell for the installer.

### Step 0 — one-time setup

1. Install **WSL2** and a distro (Ubuntu): in an admin PowerShell:

   ```powershell
   wsl --install
   ```

   Reboot if asked. Set a Linux username/password when prompted.

2. Install **Docker Desktop for Windows** and, in its settings, enable
   **Use the WSL 2 based engine** and **WSL integration** for your Ubuntu
   distro. Keep Docker Desktop running (whale icon in the tray).

### Docker (recommended)

Open your WSL2 Ubuntu terminal, ensure `curl` and `openssl` are installed, and run the [local installer](./SELF-HOSTING.md). Open <http://localhost:3210/app/> in your browser. The installer is a Bash script; do not run it directly in PowerShell. Keep the installation inside the WSL filesystem, such as `~/janosik`.

### From source

For development, we recommend WSL2 Ubuntu for native Linux tooling and fast
file watching:

```bash
# Node via nvm (the distro `nodejs` is often too old for the backend engines):
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install                     # reads .nvmrc (Node 24)
git clone https://github.com/VitalyTolstik/janosik.git
cd janosik && npm install
npm run dev                     # → http://localhost:5173 (server mode)
```

`npm run dev` alone shows a **sign-in screen** (the dev UI is always in server
mode) — add the dev database + API per
[From source, all platforms](#from-source-all-platforms) to get a board. The
marketing site is a separate dev server:

```bash
PUBLIC_APP_URL=http://localhost:5173 npm run dev:site   # → http://localhost:4321
```

In dev both cross-links need pointing: `PUBLIC_APP_URL` for the site's "Sign in"
/ "Create account" CTAs (they default to `/app/`, which only exists in the
self-host image) and `VITE_SITE_URL` for the app's **Help → Documentation**
link. Without them the site CTAs 404 on `:4321/app/` and Help 404s on
`:5173/docs/`:

```bash
VITE_SITE_URL=http://localhost:4321/ npm run dev        # UI   (:5173)
PUBLIC_APP_URL=http://localhost:5173 npm run dev:site   # site (:4321)
```

See the README and the "Split deployment" section of `docs/SELF-HOSTING.md`.

> **WSL gotcha — background servers die with the shell.** A process started from
> a one-shot `wsl.exe … &`/`nohup` is killed the moment that `wsl.exe` session
> ends (WSL terminates the whole tree). So run the dev servers in a terminal you
> keep open, or as a **systemd unit** (`systemd-run`/`systemctl`) so they survive
> across `wsl.exe` calls and reboots. This matters for scripts and AI agents
> that start a server and then return.

On native Windows, install **Node.js 22 LTS or newer** (the repo pins 24 via
`.nvmrc`) from nodejs.org (or via `winget install OpenJS.NodeJS.LTS` / `fnm`),
then the same `npm install` / `npm run dev`. Use PowerShell or Git Bash.

---

## Linux

### Docker (recommended)

1. Install Docker Engine + the Compose plugin. The official convenience script
   is the quickest:

   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker "$USER"   # then log out and back in
   ```

   Or use your distro's packages (Debian/Ubuntu):

   ```bash
   sudo apt update
   sudo apt install -y docker.io docker-compose-v2
   sudo systemctl enable --now docker
   sudo usermod -aG docker "$USER"
   ```

2. Ensure `curl` and OpenSSL are installed, then run the [local installer](./SELF-HOSTING.md). Open <http://localhost:3210/app/> in your browser.

For access from other devices or a public server, see the LAN and HTTPS instructions in [SELF-HOSTING.md](./SELF-HOSTING.md).

### From source

```bash
# Node via nvm (recommended); the repo pins 24 in .nvmrc
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install                     # reads .nvmrc (Node 24)

git clone https://github.com/VitalyTolstik/janosik.git
cd janosik
npm install
npm run dev                     # → http://localhost:5173 (server mode: sign in / register)
```

---

## From source, all platforms

Once Node 22.17+ (the repo pins 24 via `.nvmrc`) is installed and `npm install`
has run at the repo root:

> The dev UI is **always in server mode** — `npm run dev` shows a **sign-in
> screen** and needs the API below. There is no "no-login demo board" dev run;
> the local-only (no-API) mode is what the **unit tests** exercise.

**Server mode** (accounts, shared boards, realtime):

```bash
# 1. Configure the API FIRST — the dev compose file reads POSTGRES_* from
#    backend/.env, so it must exist before `docker compose up`.
cp backend/.env.example backend/.env
#   set JWT_SECRET (openssl rand -hex 32; on PowerShell see the Windows section)

# 2. dev PostgreSQL (container janosik-postgres on port 5433)
docker compose -f backend/docker-compose.yml up -d

# 3. migrate + build + start the API (port 3000)
npm run prisma:deploy -w backend
npm run build:backend
npm run start -w backend

# 4. in a second terminal, start the UI (Vite proxies /api → :3000)
npm run dev
```

Register at <http://localhost:5173> (registration is open by default); create a
master with `npm run admin:create -w backend -- --email me@example.com` and open
`/admin`.

**Marketing site** (optional, separate dev server):

```bash
PUBLIC_APP_URL=http://localhost:5173 npm run dev:site   # → http://localhost:4321
```

In dev the app is not under `/app/` on the site (that path is for the self-host
image only), so point **both** cross-links by hand: `PUBLIC_APP_URL` at the UI
dev server (or the site's "Sign in" CTA 404s), and the UI's `VITE_SITE_URL` at
the site (or the app's **Help → Documentation** 404s):

```bash
VITE_SITE_URL=http://localhost:4321/ npm run dev        # UI   (:5173)
PUBLIC_APP_URL=http://localhost:5173 npm run dev:site   # site (:4321)
```

For a two-host production deployment the same two variables are set on the two
builds — see the "Split deployment" section of `docs/SELF-HOSTING.md`.

**Common commands:** `npm test` (UI + shared), `npm run test:backend`,
`npm run lint`, `npm run build`, `npm run size`. See the README for the full
list.

---

## Node version quick reference

| OS | Install Node 22.17+ (repo pins 24) |
| --- | --- |
| macOS | `brew install node@24` or `nvm install` (reads `.nvmrc`) |
| Windows 11 | WSL: `nvm install` (`.nvmrc`) · native: `winget install OpenJS.NodeJS.LTS` or `fnm` |
| Linux | `nvm install` (`.nvmrc`) or distro packages |

The repo selects the Node.js major version in **`.nvmrc`** (currently **24**): run `nvm use`
in the repo root, or `nvm install` once. If the backend complains about the Node
version, check with `node -v` — it must be **22.17 or newer**.
