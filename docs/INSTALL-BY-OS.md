# Running Janosik — macOS, Windows 11 and Linux

Two ways to run Janosik:

| | **Docker (recommended)** | **From source (for development)** |
| --- | --- | --- |
| What it is | Prebuilt container: whole app (API + UI) + PostgreSQL + Redis | Node dev server, optionally with a local API |
| You need | Docker Desktop / Docker Engine | Node.js 22.17+, npm |
| Best for | Actually using it, self-hosting | Changing the code |

Pick one below. For a **server** (VPS) rather than a laptop, the
[self-hosting guide](./SELF-HOSTING.md) is the deeper read — this page is about
getting it running on your own machine.

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

2. Run the stack:

   ```bash
   mkdir janosik && cd janosik
   curl -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
   curl -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
   openssl rand -hex 32            # copy into JWT_SECRET in .env
   # edit .env: JWT_SECRET, POSTGRES_PASSWORD, PUBLIC_ORIGIN=http://localhost:3000
   docker compose up -d
   ```

3. Open <http://localhost:3000>. Create your account, then create a master for
   `/admin`:

   ```bash
   docker compose exec app node backend/scripts/admin-cli.cjs create --email me@example.com
   ```

> **Apple Silicon:** the published image is built for both `arm64` and `amd64`,
> so it runs natively. If you build locally (`docker build`), it also works —
> `ffmpeg-static` and Prisma both ship arm64 binaries.

### From source

```bash
brew install node@22            # or: brew install nvm && nvm install 22 && nvm use 22
git clone https://github.com/VitalyTolstik/janosik.git
cd janosik
npm install
npm run dev                     # → http://localhost:5173 (local-only mode)
```

For server mode (accounts + PostgreSQL) add the dev database and API — see
[From source, all platforms](#from-source-all-platforms) below.

---

## Windows 11

Docker on Windows runs through **WSL2**, so the smoothest experience is to do
everything inside a WSL2 Linux shell. Native PowerShell works too.

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

**Option A — in WSL2 (recommended).** Open Ubuntu and follow the Linux
commands. `curl` and `openssl` are present:

```bash
mkdir janosik && cd janosik
curl -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
openssl rand -hex 32            # → JWT_SECRET
docker compose up -d
```

**Option B — in PowerShell.** `curl` ships with Windows 11 as `curl.exe`, but
`openssl` does **not** — generate the secret like this instead:

```powershell
mkdir janosik; cd janosik
curl.exe -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
curl.exe -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
# JWT_SECRET value (64 hex chars):
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
notepad .env                    # paste it into JWT_SECRET, set POSTGRES_PASSWORD
docker compose up -d
```

Open <http://localhost:3000> in your browser. Create the master account the
same way (works from either shell):

```powershell
docker compose exec app node backend/scripts/admin-cli.cjs create --email me@example.com
```

> **Tips**
> - Keep the project inside the WSL filesystem (e.g. `~/janosik`), not under
>   `/mnt/c/…` — file I/O across the Windows/Linux boundary is slow.
> - If `docker` isn't found in WSL, make sure WSL integration is enabled for
>   your distro in Docker Desktop → Settings → Resources → WSL Integration.
> - `.env` should be saved as **UTF-8 without BOM** and use plain LF line
>   endings; the template already does.

### From source

Prefer WSL2 Ubuntu for the dev flow (native tooling, fast file watching):

```bash
sudo apt update && sudo apt install -y nodejs npm git   # or use nvm, see Linux
git clone https://github.com/VitalyTolstik/janosik.git
cd janosik && npm install
npm run dev
```

On native Windows, install **Node.js 22 LTS** from nodejs.org (or via
`winget install OpenJS.NodeJS.LTS` / `fnm`), then the same `npm install` /
`npm run dev`. Use PowerShell or Git Bash.

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

2. Run the stack (no `sudo` needed after re-login):

   ```bash
   mkdir janosik && cd janosik
   curl -O https://raw.githubusercontent.com/VitalyTolstik/janosik/main/docker-compose.yml
   curl -o .env https://raw.githubusercontent.com/VitalyTolstik/janosik/main/.env.example
   openssl rand -hex 32            # → JWT_SECRET
   nano .env                       # JWT_SECRET, POSTGRES_PASSWORD, PUBLIC_ORIGIN
   docker compose up -d
   ```

3. Open <http://localhost:3000>, create your account and a master:

   ```bash
   docker compose exec app node backend/scripts/admin-cli.cjs create --email me@example.com
   ```

> For a public server, add TLS (Caddy/nginx) and set `COOKIE_SECURE=true` +
> `TRUST_PROXY=1` — see [SELF-HOSTING.md](./SELF-HOSTING.md). Open the firewall
> only for 80/443 (`sudo ufw allow 80,443/tcp`).

### From source

```bash
# Node 22.17+ — via nvm (recommended) or your distro
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22 && nvm use 22

git clone https://github.com/VitalyTolstik/janosik.git
cd janosik
npm install
npm run dev                     # → http://localhost:5173 (local-only mode)
```

---

## From source, all platforms

Once Node 22.17+ is installed and `npm install` has run at the repo root:

**Local-only mode** (no backend, data in the browser):

```bash
npm run dev                     # http://localhost:5173
```

**Server mode** (accounts, shared boards, realtime):

```bash
# 1. dev PostgreSQL (container janosik-postgres on port 5433)
docker compose -f backend/docker-compose.yml up -d

# 2. configure the API
cp backend/.env.example backend/.env
#   set JWT_SECRET (openssl rand -hex 32; on PowerShell see the Windows section)

# 3. migrate + build + start the API (port 3000)
npm run prisma:deploy -w backend
npm run build:backend
npm run start -w backend

# 4. in a second terminal, start the UI (Vite proxies /api → :3000)
npm run dev
```

Register at <http://localhost:5173>; create a master with
`npm run admin:create -w backend -- --email me@example.com` and open `/admin`.

**Common commands:** `npm test` (UI + shared), `npm run test:backend`,
`npm run lint`, `npm run build`, `npm run size`. See the README for the full
list.

---

## Node version quick reference

| OS | Install Node 22.17+ |
| --- | --- |
| macOS | `brew install node@22` or `nvm install 22` |
| Windows 11 | WSL: `nvm install 22` · native: `winget install OpenJS.NodeJS.LTS` or `fnm` |
| Linux | `nvm install 22` or distro packages |

If the backend complains about the Node version, check with `node -v` — it must
be **22.17 or newer**.
