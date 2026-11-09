# Forever Quest Chains

Interactive map of quest chains and unlocks for **World of Warcraft: Forever**.

Unlike a simple "series" list, it shows **non-linear unlocks** too:

- a quest that unlocks several others (`unlocks 7` badge, gold arrows)
- quests that need several quests (`AND`) or any one of several (`OR`)
- breadcrumbs, quests only available while another is active, and either/or (mutually exclusive) quests

Grey arrows are plain one-to-one chain links. Gold arrows are branching unlocks.

## Data

Quest data comes from the open-source [Questie](https://github.com/Questie/QuestieDB) addon database (GPL-3.0), which has a WoW Forever-specific quest DB with prerequisite fields. `npm run import-data` downloads it and converts it to `public/data/quests.json`.

## Run locally

```sh
npm install
npm run import-data   # downloads Questie data (add -- --offline to reuse .cache/)
npm run dev           # http://localhost:5173
npm test
```

## Share it

- **GitHub Pages (recommended).** Push to a GitHub repo, then go to *Settings → Pages → Source: GitHub Actions*. `.github/workflows/deploy.yml` builds and publishes on every push and once a day, so the data stays fresh. Share the URL.
- **Docker.** See [Run with Docker](#run-with-docker) below.

## Run with Docker

You only need [Docker](https://docs.docker.com/get-docker/) installed; you don't need Node. The image downloads the latest Questie data while it builds, so the build needs internet access.

### With Docker Compose (easiest)

```sh
docker compose up -d --build   # build the image and start it in the background
```

Open http://localhost:8080.

```sh
docker compose logs -f         # follow the logs
docker compose down            # stop and remove the container
```

### With plain Docker

```sh
docker build -t quest-viz .                                    # build the image
docker run -d --name quest-viz -p 8080:80 quest-viz            # start it
docker stop quest-viz && docker rm quest-viz                   # stop and remove it
```

### Update the quest data

The data is baked into the image when it's built. Rebuild to get the latest Questie data:

```sh
docker compose build --no-cache && docker compose up -d
# or: docker build --no-cache -t quest-viz .
```

`--no-cache` matters here. Without it, Docker can reuse the cached download step and keep the old data.

### Use a different port

Change the left-hand side of the port mapping:
- In `docker-compose.yml`, set `ports: - "3000:80"`.
- Or run `docker run -p 3000:80 quest-viz`.

Then open http://localhost:3000.

### Share the image without a registry

```sh
docker save quest-viz | gzip > quest-viz.tar.gz   # on your machine
docker load < quest-viz.tar.gz                    # on the other machine
docker run -d -p 8080:80 quest-viz
```

## How it works

| Path | Role |
| --- | --- |
| `scripts/import-questie.ts`, `scripts/convert.ts` | Download the Questie Lua files, run them in Lua (WASM, via `wasmoon`), and export JSON |
| `src/graph/build.ts` | Build typed edges and classify each one as a chain link or an unlock |
| `src/graph/subgraph.ts` | Zone, focus and filter views, and chain collapsing |
| `src/graph/layout.ts` | ELK layered layout |
| `src/components/*` | React Flow canvas, sidebar and quest panel |

The Wowhead link target is set in `src/config.ts`.
