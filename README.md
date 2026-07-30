# SupperStream Provider for Nuvio

A dependency-free Nuvio provider that resolves a Nuvio TMDB ID to an IMDb ID,
opens the compatible player page, extracts the player configuration, requests
the file list, resolves playlist URLs, and returns Nuvio stream objects.

> Use this only for media you own or are authorized to access.

## Repository layout

```text
supperstream-nuvio/
├── manifest.json
├── providers/
│   └── supperstream.js
├── tools/
│   ├── test.js
│   └── validate-manifest.js
├── .github/workflows/validate.yml
├── package.json
├── LICENSE
└── README.md
```

## GitHub upload

Create an empty GitHub repository, then run:

```bash
cd supperstream-nuvio

git init
git add .
git commit -m "Add SupperStream Nuvio provider"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/supperstream-nuvio.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

## Install in Nuvio

After pushing to GitHub, add this URL in Nuvio:

```text
https://raw.githubusercontent.com/YOUR_USERNAME/supperstream-nuvio/refs/heads/main/manifest.json
```

In Nuvio:

1. Open **Settings**
2. Open **Plugins** or **Local Scrapers**
3. Add the raw `manifest.json` URL
4. Refresh the repository
5. Enable **SupperStream**

## Local validation

Node.js 18 or newer:

```bash
npm run check
```

Test directly with an IMDb ID:

```bash
npm test -- tt15692286 movie
```

Test using a TMDB ID:

```bash
npm test -- 550 movie
```

TV test:

```bash
npm test -- TMDB_TV_ID tv 1 1
```

## Local Nuvio testing

Serve the repository:

```bash
npm run serve
```

Then use your computer's LAN address in Nuvio Plugin Tester:

```text
http://YOUR_LOCAL_IP:3000/manifest.json
```

Example:

```text
http://192.168.1.5:3000/manifest.json
```

## Provider behavior

The exported function has the Nuvio signature:

```js
getStreams(tmdbId, mediaType, season, episode)
```

Returned streams contain:

```js
{
  name: "SupperStream",
  title: "SupperStream - 1080p",
  url: "https://example.com/master.m3u8",
  quality: "1080p",
  format: "m3u8",
  provider: "supperstream",
  headers: {
    Referer: "https://laika422mon.com/",
    Origin: "https://laika422mon.com",
    "User-Agent": "..."
  }
}
```

## Configuration

The current compatible player origin is defined near the top of
`providers/supperstream.js`:

```js
var PLAYER_ORIGIN = "https://laika422mon.com";
```

Change that single value if the domain changes, then update the provider
version in `manifest.json`.

## Notes

- The Nuvio provider intentionally does not use `fs`, `process`, local files,
  npm packages, or other Node-only APIs.
- Promise chains are used for better compatibility with Nuvio's Hermes
  plugin runtime.
- TMDB-to-IMDb resolution first checks the public TMDB page and then tries
  Cinemeta as a fallback.
- TV episode matching supports common labels such as `S01E02`, `1x02`, and
  `Season 1 Episode 2`. If the upstream returns no episode labels, all
  extracted files are returned as a fallback.
- The GitHub Action validates JavaScript syntax, the manifest, provider paths,
  and the required `getStreams` export.
