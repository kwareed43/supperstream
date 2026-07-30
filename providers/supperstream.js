/**
 * SupperStream provider for Nuvio
 *
 * Nuvio entry:
 *   getStreams(tmdbId, mediaType, season, episode)
 *
 * Runtime notes:
 * - Dependency-free
 * - Promise-based for Hermes compatibility
 * - No Node.js-only APIs such as fs, path or process
 */

"use strict";

var PROVIDER_ID = "supperstream";
var PROVIDER_NAME = "SupperStream";
var PLAYER_ORIGIN = "https://laika422mon.com";

var HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/137.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9," +
    "image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5"
};

function log(message) {
  console.log("[" + PROVIDER_NAME + "] " + message);
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, function (_, number) {
      return String.fromCharCode(Number(number));
    })
    .replace(/&#x([0-9a-f]+);/gi, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
}

function extractExternalScriptUrls(html, baseUrl) {
  var urls = [];
  var scriptRegex = /<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
  var match;

  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      var decodedSrc = decodeHtmlEntities(match[2]).trim();
      if (!decodedSrc) continue;

      var absoluteUrl = new URL(decodedSrc, baseUrl).href;
      if (urls.indexOf(absoluteUrl) === -1) urls.push(absoluteUrl);
    } catch (_) {}
  }

  return urls;
}

function extractInlineScripts(html) {
  var scripts = [];
  var scriptRegex = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  var match;

  while ((match = scriptRegex.exec(html)) !== null) {
    var code = match[1] || "";
    if (code.trim()) scripts.push(code);
  }

  return scripts;
}

function extractBalancedObject(code, startIndex) {
  var objectStart = -1;
  var i;

  for (i = startIndex; i < code.length; i++) {
    if (code[i] === "{") {
      objectStart = i;
      break;
    }
    if (code[i] === ";" || code[i] === "\n") return null;
  }

  if (objectStart === -1) return null;

  var depth = 0;
  var quote = null;
  var escaped = false;
  var singleLineComment = false;
  var multiLineComment = false;

  for (i = objectStart; i < code.length; i++) {
    var ch = code[i];
    var next = code[i + 1] || "";

    if (singleLineComment) {
      if (ch === "\n") singleLineComment = false;
      continue;
    }

    if (multiLineComment) {
      if (ch === "*" && next === "/") {
        multiLineComment = false;
        i++;
      }
      continue;
    }

    if (quote !== null) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "/" && next === "/") {
      singleLineComment = true;
      i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      multiLineComment = true;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "{") {
      depth++;
      continue;
    }

    if (ch === "}") {
      depth--;
      if (depth === 0) return code.slice(objectStart, i + 1);
    }
  }

  return null;
}

function decodeJavaScriptString(value) {
  return String(value)
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractStringProperty(objectText, propertyName) {
  var escapedName = escapeRegex(propertyName);
  var patterns = [
    new RegExp("[\"']" + escapedName + "[\"']\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"", "i"),
    new RegExp("[\"']" + escapedName + "[\"']\\s*:\\s*'((?:\\\\.|[^'\\\\])*)'", "i"),
    new RegExp("\\b" + escapedName + "\\b\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"", "i"),
    new RegExp("\\b" + escapedName + "\\b\\s*:\\s*'((?:\\\\.|[^'\\\\])*)'", "i")
  ];

  for (var i = 0; i < patterns.length; i++) {
    var match = objectText.match(patterns[i]);
    if (match) return decodeJavaScriptString(match[1]);
  }

  return null;
}

function parsePlayerConfigObject(objectText) {
  if (!objectText) return null;

  try {
    var parsed = JSON.parse(objectText);
    if (
      parsed &&
      typeof parsed.file === "string" &&
      typeof parsed.key === "string"
    ) {
      return parsed;
    }
  } catch (_) {}

  var file = extractStringProperty(objectText, "file");
  var key = extractStringProperty(objectText, "key");

  return file && key ? { file: file, key: key } : null;
}

function findP3Config(code) {
  var patterns = [
    /(?:let|const|var)\s+p3\s*=/g,
    /window\s*\.\s*p3\s*=/g,
    /globalThis\s*\.\s*p3\s*=/g,
    /(?:^|[;\s])p3\s*=/g
  ];

  for (var i = 0; i < patterns.length; i++) {
    var pattern = patterns[i];
    pattern.lastIndex = 0;
    var match;

    while ((match = pattern.exec(code)) !== null) {
      var objectText = extractBalancedObject(
        code,
        match.index + match[0].length
      );
      var config = parsePlayerConfigObject(objectText);
      if (config) return config;
    }
  }

  return null;
}

function findGenericPlayerConfig(code) {
  var assignmentPattern = /(?:let|const|var)\s+[A-Za-z_$][\w$]*\s*=/g;
  var match;

  while ((match = assignmentPattern.exec(code)) !== null) {
    var objectText = extractBalancedObject(
      code,
      match.index + match[0].length
    );

    if (!objectText) continue;
    if (!/\bfile\b\s*:/.test(objectText) || !/\bkey\b\s*:/.test(objectText)) {
      continue;
    }

    var config = parsePlayerConfigObject(objectText);
    if (config) return config;
  }

  return null;
}

function findPlayerConfig(code) {
  return findP3Config(code) || findGenericPlayerConfig(code);
}

function fetchText(url, options) {
  return fetch(url, options || {}).then(function (response) {
    return response.text().then(function (text) {
      if (!response.ok) {
        throw new Error(
          "HTTP " + response.status + " for " + url +
          " | " + text.slice(0, 180).replace(/\s+/g, " ")
        );
      }
      return {
        text: text,
        url: response.url || url,
        status: response.status,
        headers: response.headers
      };
    });
  });
}

function scanExternalScripts(scriptUrls, index, embedUrl, playerOrigin) {
  if (index >= scriptUrls.length) return Promise.resolve(null);

  var scriptUrl = scriptUrls[index];

  return fetchText(scriptUrl, {
    method: "GET",
    headers: Object.assign({}, HEADERS, {
      "Accept": "*/*",
      "Referer": embedUrl,
      "Origin": playerOrigin
    }),
    redirect: "follow"
  })
    .then(function (result) {
      return findPlayerConfig(result.text);
    })
    .catch(function (error) {
      log("Script skipped: " + error.message);
      return null;
    })
    .then(function (config) {
      if (config) return config;
      return scanExternalScripts(scriptUrls, index + 1, embedUrl, playerOrigin);
    });
}

function extractPlayerConfig(html, embedUrl, playerOrigin) {
  var config = findPlayerConfig(html);
  if (config) return Promise.resolve(config);

  var inlineScripts = extractInlineScripts(html);
  for (var i = 0; i < inlineScripts.length; i++) {
    config = findPlayerConfig(inlineScripts[i]);
    if (config) return Promise.resolve(config);
  }

  var externalScripts = extractExternalScriptUrls(html, embedUrl);
  return scanExternalScripts(externalScripts, 0, embedUrl, playerOrigin);
}

function parsePlaylistResponse(text) {
  var value = String(text).trim();

  try {
    var parsed = JSON.parse(value);
    if (typeof parsed === "string") value = parsed;
    else if (parsed && typeof parsed.url === "string") value = parsed.url;
    else if (parsed && typeof parsed.file === "string") value = parsed.file;
    else if (parsed && typeof parsed.src === "string") value = parsed.src;
  } catch (_) {}

  return decodeJavaScriptString(value)
    .replace(/^["']|["']$/g, "")
    .trim();
}

function parseLooseJson(text) {
  return JSON.parse(
    String(text)
      .replace(/,\s*]/g, "]")
      .replace(/,\s*}/g, "}")
  );
}

function buildPlaylistUrl(playerOrigin, playlistFile) {
  var cleaned = String(playlistFile).replace(/^~/, "").trim();
  var encoded = cleaned
    .split("/")
    .map(function (part) {
      return encodeURIComponent(part);
    })
    .join("/");

  return playerOrigin + "/playlist/" + encoded + ".txt";
}

function normalizeQuality(value) {
  var text = String(value || "Auto");
  var match = text.match(/(2160|1440|1080|720|480|360)\s*p?/i);
  return match ? match[1] + "p" : text;
}

function matchesEpisode(fileObject, season, episode) {
  if (!season || !episode) return true;

  var searchable = [
    fileObject.title,
    fileObject.label,
    fileObject.quality,
    fileObject.name,
    fileObject.file
  ].filter(Boolean).join(" ");

  var s = String(Number(season));
  var e = String(Number(episode));
  var ss = s.length < 2 ? "0" + s : s;
  var ee = e.length < 2 ? "0" + e : e;

  var patterns = [
    new RegExp("S" + ss + "\\s*E" + ee, "i"),
    new RegExp("S" + s + "\\s*E" + e, "i"),
    new RegExp("Season\\s*" + s + "[^0-9]+Episode\\s*" + e, "i"),
    new RegExp("\\b" + s + "x" + ee + "\\b", "i"),
    new RegExp("\\bEpisode\\s*" + e + "\\b", "i")
  ];

  return patterns.some(function (pattern) {
    return pattern.test(searchable);
  });
}

/**
 * Resolve Nuvio's TMDB id to an IMDb id.
 *
 * First it tries the TMDB public title page. The page commonly contains
 * an imdb_id field in its serialized metadata. It then falls back to
 * Cinemeta, which may return an IMDb id for the title.
 *
 * An incoming tt... id is accepted directly for easier testing.
 */
function resolveImdbId(tmdbId, mediaType) {
  var input = String(tmdbId || "").trim();

  if (/^tt\d+$/i.test(input)) {
    return Promise.resolve(input.toLowerCase());
  }

  if (!/^\d+$/.test(input)) {
    return Promise.reject(new Error("Invalid TMDB/IMDb id: " + input));
  }

  var tmdbType = mediaType === "tv" ? "tv" : "movie";
  var tmdbUrl = "https://www.themoviedb.org/" + tmdbType + "/" + input;

  return fetchText(tmdbUrl, {
    method: "GET",
    headers: HEADERS,
    redirect: "follow"
  })
    .then(function (result) {
      var patterns = [
        /["']imdb_id["']\s*:\s*["'](tt\d+)["']/i,
        /imdb_id\\?["']?\s*[:=]\s*\\?["'](tt\d+)/i,
        /https?:\/\/(?:www\.)?imdb\.com\/title\/(tt\d+)/i
      ];

      for (var i = 0; i < patterns.length; i++) {
        var match = result.text.match(patterns[i]);
        if (match) return match[1].toLowerCase();
      }

      throw new Error("IMDb id not found in TMDB page");
    })
    .catch(function (firstError) {
      var cinemetaUrl =
        "https://v3-cinemeta.strem.io/meta/" +
        (mediaType === "tv" ? "series" : "movie") +
        "/tmdb:" + input + ".json";

      return fetchText(cinemetaUrl, {
        method: "GET",
        headers: { "Accept": "application/json" },
        redirect: "follow"
      }).then(function (result) {
        var data = JSON.parse(result.text);
        var candidates = [
          data && data.meta && data.meta.imdb_id,
          data && data.meta && data.meta.imdbId,
          data && data.meta && data.meta.id,
          data && data.imdb_id,
          data && data.imdbId
        ];

        for (var i = 0; i < candidates.length; i++) {
          if (/^tt\d+$/i.test(String(candidates[i] || ""))) {
            return String(candidates[i]).toLowerCase();
          }
        }

        throw new Error(
          "IMDb mapping failed. TMDB error: " + firstError.message
        );
      });
    });
}

function extractOnePlaylist(fileObject, index, playerConfig, embedUrl, playerOrigin) {
  var playlistUrl = buildPlaylistUrl(playerOrigin, fileObject.file);

  return fetchText(playlistUrl, {
    method: "POST",
    headers: Object.assign({}, HEADERS, {
      "Accept": "*/*",
      "X-CSRF-TOKEN": playerConfig.key,
      "Referer": embedUrl,
      "Origin": playerOrigin
    }),
    redirect: "follow"
  }).then(function (result) {
    var m3u8Url = parsePlaylistResponse(result.text);

    if (!/^https?:\/\//i.test(m3u8Url)) {
      throw new Error("Invalid playlist response: " + m3u8Url.slice(0, 120));
    }

    var rawQuality =
      fileObject.title ||
      fileObject.label ||
      fileObject.quality ||
      "Stream " + (index + 1);

    var quality = normalizeQuality(rawQuality);

    return {
      name: PROVIDER_NAME,
      title: PROVIDER_NAME + " - " + rawQuality,
      url: m3u8Url,
      quality: quality,
      format: "m3u8",
      headers: {
        "Referer": playerOrigin + "/",
        "Origin": playerOrigin,
        "User-Agent": HEADERS["User-Agent"]
      },
      provider: PROVIDER_ID
    };
  });
}

function getStreamsFromPlayUrl(playUrl, season, episode) {
  var parsedPlayUrl;

  try {
    parsedPlayUrl = new URL(playUrl);
  } catch (_) {
    return Promise.resolve([]);
  }

  var playerOrigin = parsedPlayUrl.origin;
  var normalizedPath = parsedPlayUrl.pathname.replace(/\/{2,}/g, "/");
  var embedUrl = playerOrigin + normalizedPath + parsedPlayUrl.search;

  log("Opening " + embedUrl);

  return fetchText(embedUrl, {
    method: "GET",
    headers: Object.assign({}, HEADERS, {
      "Referer": playerOrigin + "/"
    }),
    redirect: "follow"
  })
    .then(function (playerResult) {
      return extractPlayerConfig(
        playerResult.text,
        embedUrl,
        playerOrigin
      );
    })
    .then(function (playerConfig) {
      if (!playerConfig) {
        throw new Error("Player configuration not found");
      }

      var fileApiUrl = String(playerConfig.file)
        .replace(/\\\//g, "/")
        .trim();

      if (!/^https?:\/\//i.test(fileApiUrl)) {
        fileApiUrl = new URL(fileApiUrl, playerOrigin).href;
      }

      return fetchText(fileApiUrl, {
        method: "POST",
        headers: Object.assign({}, HEADERS, {
          "Accept": "*/*",
          "X-CSRF-TOKEN": playerConfig.key,
          "Referer": embedUrl,
          "Origin": playerOrigin
        }),
        redirect: "follow"
      }).then(function (fileResult) {
        return {
          playerConfig: playerConfig,
          parsedData: parseLooseJson(fileResult.text)
        };
      });
    })
    .then(function (context) {
      if (!Array.isArray(context.parsedData)) {
        throw new Error("File API response is not an array");
      }

      var targetFiles = context.parsedData.filter(function (item) {
        return (
          item &&
          typeof item === "object" &&
          typeof item.file === "string" &&
          matchesEpisode(item, season, episode)
        );
      });

      /*
       * Some providers return only the selected episode without a useful
       * episode label. In that case, retry using every file rather than
       * returning nothing.
       */
      if (!targetFiles.length && season && episode) {
        targetFiles = context.parsedData.filter(function (item) {
          return item && typeof item === "object" && typeof item.file === "string";
        });
      }

      return Promise.all(
        targetFiles.map(function (fileObject, index) {
          return extractOnePlaylist(
            fileObject,
            index,
            context.playerConfig,
            embedUrl,
            playerOrigin
          ).catch(function (error) {
            log("Playlist skipped: " + error.message);
            return null;
          });
        })
      );
    })
    .then(function (streams) {
      var seen = {};
      return streams.filter(function (stream) {
        if (!stream || seen[stream.url]) return false;
        seen[stream.url] = true;
        return true;
      });
    })
    .catch(function (error) {
      console.error("[" + PROVIDER_NAME + "] " + error.message);
      return [];
    });
}

/**
 * Required Nuvio provider function.
 */
function getStreams(tmdbId, mediaType, season, episode) {
  var type = mediaType === "tv" ? "tv" : "movie";

  return resolveImdbId(tmdbId, type)
    .then(function (imdbId) {
      var playUrl = PLAYER_ORIGIN + "/play/" + imdbId;
      return getStreamsFromPlayUrl(playUrl, season, episode);
    })
    .catch(function (error) {
      console.error("[" + PROVIDER_NAME + "] " + error.message);
      return [];
    });
}

module.exports = {
  getStreams: getStreams,
  getStreamsFromPlayUrl: getStreamsFromPlayUrl,
  resolveImdbId: resolveImdbId
};
