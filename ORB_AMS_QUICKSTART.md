# Running ORB + AMS together

Operator quickstart for self-hosting **ORB** (the review stack in the root [`docker-compose.yml`](docker-compose.yml)) and **AMS** (`@loopover/miner`, fleet or laptop) on **one host**, including the Grafana `ams-observability` bridge.

Each product works alone. This page is the single path that documents how their compose files, volumes, and `LOOPOVER_MINER_CONFIG_DIR` interact. AMS-only deploy details stay in [`packages/loopover-miner/DEPLOYMENT.md`](packages/loopover-miner/DEPLOYMENT.md); AMS Grafana wiring stays in [`packages/loopover-miner/docs/observability.md`](packages/loopover-miner/docs/observability.md).

## What you get

| Piece | Compose file | Role |
| ----- | ------------ | ---- |
| ORB | root `docker-compose.yml` | Self-hosted LoopOver API / review agent (and optional Prometheus + Grafana) |
| AMS fleet worker | `packages/loopover-miner/docker-compose.miner.yml` | Long-lived miner container (`command: ["run"]`) |
| AMS → Grafana bridge | same root compose, `--profile ams-observability` | `ams-reporting-exporter` redacts miner ledgers into Grafana's reporting volume |

Grafana itself lives under `--profile observability`. The AMS exporter is a **separate** profile (`ams-observability`) so engine-only deployments do not start it. For panels to appear you need **both** profiles (plus a miner writing ledgers the exporter can read).

## Prerequisites

1. Docker Compose v2 on the host.
2. ORB secrets: copy [`.env.selfhost.example`](.env.selfhost.example) (or [`.env.example`](.env.example)) → `.env` at the repo root and fill GitHub App credentials. Never commit real values.
3. AMS secrets (fleet path): from `packages/loopover-miner/`:

   ```sh
   cp .loopover-miner.env.example .loopover-miner.env
   # fill GITHUB_TOKEN (+ optional coding-agent provider keys)
   ```

4. Optional — custom shared state directory (defaults are fine):

   ```sh
   # In the repo-root `.env` (and exported in the shell if you prefer):
   LOOPOVER_MINER_CONFIG_DIR=~/.config/loopover-miner
   ```

## Env vars that must agree

| Variable | ORB side | AMS side | Notes |
| -------- | -------- | -------- | ----- |
| `LOOPOVER_MINER_CONFIG_DIR` | Host path mounted **read-only** on `ams-reporting-exporter` at `/ams-ledgers` (default `~/.config/loopover-miner`) | **Laptop:** where the CLI writes SQLite. **Fleet + override:** host path bind-mounted at the container's `/data/miner` | Set once; both sides use the same default when unset. |
| AMS credentials | Not shared with ORB | `.loopover-miner.env` (`GITHUB_TOKEN`, …) | ORB uses the root `.env` GitHub App material; do not mix the two secret files. |

### Laptop mode vs fleet mode state

| AMS mode | Where ledgers live by default | Extra step for `ams-observability` |
| -------- | ----------------------------- | ---------------------------------- |
| Laptop (`loopover-miner` on the host) | `~/.config/loopover-miner` | None — matches the exporter bind mount |
| Fleet (`docker-compose.miner.yml` alone) | Named Docker volume `miner-data` → `/data/miner` | **Required:** copy the opt-in override so fleet state is a **host** directory the exporter can read (see below). Without it, Grafana AMS datasources stay **silently empty**. |

The fleet bridge is the `#5805` override in [`packages/loopover-miner/docker-compose.miner.override.yml.example`](packages/loopover-miner/docker-compose.miner.override.yml.example). It replaces the named-volume mount for `/data/miner` with `${LOOPOVER_MINER_CONFIG_DIR:-~/.config/loopover-miner}:/data/miner` — the same expression `ams-reporting-exporter` already uses.

## Worked example: ORB + AMS fleet + Grafana AMS panels

Run from the **monorepo root**. This is the verified two-product invocation (ORB profiles + AMS fleet compose + fleet↔exporter bridge).

```sh
# 1) One-time: opt-in host bind so fleet state matches the exporter (gitignored after copy)
cp packages/loopover-miner/docker-compose.miner.override.yml.example \
   packages/loopover-miner/docker-compose.miner.override.yml

# 2) Stand up ORB (API + observability stack) and AMS exporter + fleet miner together
docker compose \
  -f docker-compose.yml \
  -f packages/loopover-miner/docker-compose.miner.yml \
  -f packages/loopover-miner/docker-compose.miner.override.yml \
  --profile observability \
  --profile ams-observability \
  up -d --build
```

### Expected output (shape)

`docker compose … up -d --build` should finish with services including at least:

- ORB core (e.g. `loopover`, Redis / SQLite stack depending on your base profiles)
- `grafana`, `prometheus`, … from `--profile observability`
- `ams-reporting-exporter` from `--profile ams-observability`
- `miner` from `docker-compose.miner.yml`

Then:

```sh
docker compose \
  -f docker-compose.yml \
  -f packages/loopover-miner/docker-compose.miner.yml \
  -f packages/loopover-miner/docker-compose.miner.override.yml \
  --profile observability \
  --profile ams-observability \
  ps
```

`ams-reporting-exporter` and `miner` should be `running`. After the miner has written `attempt-log.sqlite3` / `prediction-ledger.sqlite3` under `LOOPOVER_MINER_CONFIG_DIR`, the exporter's healthcheck expects a non-empty redacted `/reporting/ams-attempt-log.sqlite` (default interval 30s).

### Confirm Grafana AMS panels (fleet mode)

1. Open Grafana (default published port from the observability profile — see your `.env` / compose port mapping).
2. **Connections → Data sources** should list **AMS Attempt Log** and **AMS Prediction Ledger** (provisioned from [`grafana/provisioning/datasources/ams-ledgers.yml`](grafana/provisioning/datasources/ams-ledgers.yml)).
3. Explore either datasource after at least one export cycle. Empty tables before the miner has logged attempts is normal; **empty forever** usually means the exporter and miner still disagree on the host path (missing override, or a custom `LOOPOVER_MINER_CONFIG_DIR` set on only one side).

Deep dive on what is exported vs kept private: [`packages/loopover-miner/docs/observability.md`](packages/loopover-miner/docs/observability.md). Bridge rationale and AMS-only wording: [DEPLOYMENT.md — Running fleet mode alongside ORB's `ams-observability` profile](packages/loopover-miner/DEPLOYMENT.md#running-fleet-mode-alongside-orbs-ams-observability-profile).

## Alternative: ORB + laptop-mode AMS

No fleet compose / override needed — the CLI already writes to the host directory the exporter mounts.

```sh
# Terminal A — ORB + Grafana + AMS exporter
docker compose \
  -f docker-compose.yml \
  --profile observability \
  --profile ams-observability \
  up -d

# Terminal B — AMS on the host (same LOOPOVER_MINER_CONFIG_DIR default)
loopover-miner doctor
loopover-miner run    # or: loopover-miner loop
```

## Split commands (when you prefer separate projects)

You can start ORB and AMS in two processes. Keep the **same** `LOOPOVER_MINER_CONFIG_DIR` in the environment for both, and pass the override whenever the fleet miner should feed Grafana:

```sh
# ORB + observability + AMS exporter
docker compose -f docker-compose.yml \
  --profile observability --profile ams-observability up -d

# AMS fleet (bridge override so ledgers land on the host path)
cp packages/loopover-miner/docker-compose.miner.override.yml.example \
   packages/loopover-miner/docker-compose.miner.override.yml
docker compose \
  -f packages/loopover-miner/docker-compose.miner.yml \
  -f packages/loopover-miner/docker-compose.miner.override.yml \
  up -d --build
```

Do **not** run fleet without the override and expect `ams-observability` panels to fill — named-volume paths are not the exporter's host bind.

## Notes verified against current compose (not historical issue text)

- `#5805` is **merged**: the opt-in override + DEPLOYMENT bridge section are the supported fleet↔exporter path. No further code change is required for path alignment.
- Root `docker-compose.yml` PROFILES header comment may still omit `ams-observability` / `backup` (tracked separately); the `ams-reporting-exporter` service **does** declare `profiles: ["ams-observability"]` and is what this quickstart activates.
- `packages/loopover-miner/docker-compose.miner.yml` currently tags the built image `gittensory-miner:latest` while the Dockerfile entrypoint is `loopover-miner` — cosmetic until that tag is renamed; compose `build` still produces a working local image.

## Out of scope

- Operational runbooks, alert tuning, and backup/restore — see AMS [`operations-runbook`](packages/loopover-miner/docs/operations-runbook.md) and ORB self-host docs.
- Scaling N concurrent fleet workers on one SQLite volume — unsafe; see DEPLOYMENT.md (separate compose projects or Kubernetes).
