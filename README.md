# GeoGuessr Location

[![Version](https://img.shields.io/badge/version-1.2.0-00f5ff)](manifest.json)

Cyberpunk Chrome extension for [GeoGuessr](https://www.geoguessr.com): live location overlay, scatter-radius pin placement, and a neon map panel.

**By [revor](https://buymeacoffee.com/revor)** · [GitHub](https://github.com/DaOberhammer/GeoGuessr-Location)

## Features

- Live coordinates + dark cyberpunk map overlay
- **SET PIN** — places a marker on the GeoGuessr guess map
- **Scatter radius** slider (0–120 km) for human-like random placement
- Google Maps link
- 100% local — no API keys, no tracking

## Install

1. Download or clone this repo
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select this folder
6. Start a GeoGuessr round — the panel appears automatically

### Clone

```bash
git clone https://github.com/DaOberhammer/GeoGuessr-Location.git
cd GeoGuessr-Location
```

Then load the folder in Chrome as above.

## Usage

1. Start any GeoGuessr game mode
2. Wait for `// GEO_SIGNAL` to lock onto the round
3. Adjust **SCATTER RADIUS** if you want random offset
4. Click **SET PIN**, then press **Guess** in GeoGuessr

| Radius | Behavior |
|--------|----------|
| `0 km · EXACT` | Pin on the exact location |
| `± N km` | Random point inside the circle |

## Support

GeoGuessr Location is 100% free. If it helps you out:

**[☕ Buy revor a coffee](https://buymeacoffee.com/revor)**

## Disclaimer

For educational purposes. Using location tools in ranked or competitive play may be considered unfair. Not affiliated with GeoGuessr.

## License

[MIT License](LICENSE) — Copyright (c) 2026 revor