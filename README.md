# Diskdask Guild Chronicle

A small, static guild overview for WoW Forever EU PvP. The page reads `data.json`; `scripts/refresh_snapshot.py` fetches the guild roster, character portraits, professions, and activity counters from Blizzard.

## Local refresh

Keep the Blizzard API credentials in the ignored `.env` file, then run:

```sh
python3 scripts/refresh_snapshot.py
```

The collector uses Python's standard library. It saves a normalized snapshot to `data.json`, keeps last-good character records when an individual request fails, and reports incomplete character profiles. A private `.cache/` stores Blizzard achievement definitions. XP and activity observations are retained for 90 days; at most the first and last observation each UTC day are kept.

## Chronicle data

`chronicle-config.json` contains the experience curve, dungeon level ranges, final-boss rules, and Legacy reward thresholds. Final-boss rules are intentionally explicit: a recorded kill of the configured final boss is a clear, a different recorded boss is partial progress, and a dungeon without a verified rule is marked with `?`. The level recommendations draw from the community's [Forever dungeon catalogue](https://github.com/Klippan-Forever/tracker/blob/main/dungeons.json); observed boss IDs come from Blizzard's character statistics. The XP curve is the [Forever client XP table](https://realmfirst.net/world-of-warcraft-forever/leveling-guide/wow-forever-xp-per-level/).

Legacy challenges are fetched from Blizzard and count only entries whose criteria say completed and whose definitions award Legacy points. Conflicting completion timestamps are shown as unresolved. Blizzard's Spelunker challenge includes Excavation Site: Wetlands, so its completion can supply the dungeon check even when there is no individual boss counter. To combine mains and alts in the Legacy ledger, edit `accounts` in `chronicle-config.json` and use Blizzard character IDs from `data.json`, for example:

```json
{"name":"Player name","characterIds":[2496637,2496638]}
```

Squad rank filters and Legacy account links are separate. Weekly awards compare recorded counter values since Monday UTC and require two observations. The first refresh seeds the history baseline; recent changes and XP charts become more useful after additional refreshes.

Refresh on a schedule or run manually with `python3 scripts/refresh_snapshot.py`. Keep `.env` private and do not publish it.

## GitHub Pages refresh

The workflow in `.github/workflows/refresh-and-publish.yml` refreshes the snapshot hourly at 17 minutes past the hour (UTC), and can also be run manually from the Actions tab. It commits the new `data.json` so character history carries forward, then deploys the static site to GitHub Pages.

To enable it, add `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET` under **Settings → Secrets and variables → Actions**, then set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. Keep the local `.env` file out of GitHub.

## Local preview

After creating the snapshot, start a static server from this folder:

```sh
python3 -m http.server 4173
```

Open `http://localhost:4173` in a browser. Stop the server with Ctrl+C. This local preview does not publish the page or schedule refreshes.
