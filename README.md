# Timeline Component - Enhanced Edition

Enhanced version of the ScalarGIS `Timeline` component
(`packages/components/src/Timeline/src`).

Original source files:
- [Main.js](https://raw.githubusercontent.com/scalargis/scalargis-client/refs/heads/main/packages/components/src/Timeline/src/Main.js)
- [TimelineControl.js](https://raw.githubusercontent.com/scalargis/scalargis-client/refs/heads/main/packages/components/src/Timeline/src/TimelineControl.js)
- [config.example.json](https://raw.githubusercontent.com/scalargis/scalargis-client/refs/heads/main/packages/components/src/Timeline/src/config.example.json)
- [style.css](https://raw.githubusercontent.com/scalargis/scalargis-client/refs/heads/main/packages/components/src/Timeline/src/style.css)

Also modified: `packages/viewer/src/core/models/FeatureInfo.js`
(TIME dimension injection into WMTS GetFeatureInfo requests).

---

## Full `config_json` reference

```jsonc
{
  // ── Data source ──────────────────────────────────────────────────────────────

  "datasource": {
    // NEW: array of ScalarGIS layer IDs to control simultaneously.
    // All layers receive the same TIME value. The widget is active as long as
    // at least one layer is visible; it collapses when all are hidden.
    "layer_ids": ["frp_mtg", "modis_terra", "era5land_wind"],

    // LEGACY (still supported): single primary layer + optional extras.
    // Use layer_ids[] instead for new configurations.
    "layer_id":        "layer1",
    "extra_layer_ids": ["layer2", "layer3"],
    "parent_id":       "main"   // group to register inline layers under
  },

  // ── Initial position ─────────────────────────────────────────────────────────

  // Which date to show when the widget first loads (or after a dimension
  // refresh if the current date falls outside the new range).
  //
  //  "last"   Most recent date in the dimension (default). Best for
  //           historical / near-realtime feeds (MTG, MODIS, ERA5).
  //  "first"  Earliest date in the dimension.
  //  "now"    Current moment, snapped to the nearest step boundary and
  //           clamped to [minDate, maxDate].
  //           Snap rules by step magnitude:
  //             sub-hourly (e.g. PT10M) → floor to step boundary from epoch
  //             PT1H – PT23H            → floor to current UTC hour
  //             P1D                     → start of current UTC day
  //             P1M or longer           → first day of current UTC month
  //           For forecast layers (range in the future), "now" clamps to
  //           minDate (first forecast step). Best for forecast and
  //           near-realtime layers.
  //  N (int)  Nth step from minDate, 1-based.
  "selectedIndex": "last",

  // ── Automatic refresh ────────────────────────────────────────────────────────

  // Seconds between automatic GetCapabilities re-fetches. The current position
  // is preserved across refreshes unless it falls outside the new range.
  // Recommended values:
  //   600   — 10-minute feeds (MTG)
  //   3600  — hourly feeds (ERA5)
  //   86400 — daily feeds (MODIS)
  // Omit or set to 0 to disable.
  "refreshInterval": 600,

  // ── GetCapabilities timeout ──────────────────────────────────────────────────

  // Seconds to wait for each GetCapabilities response before cancelling the
  // request and continuing with whatever other servers have already replied.
  // Prevents the widget from stalling for minutes when a server is unreachable
  // or a proxy returns a delayed 504 Gateway Timeout.
  // Default: 10. Set higher for known slow servers.
  "capabilitiesTimeout": 10,

  // ── Playback ─────────────────────────────────────────────────────────────────

  // Whether the Play animation wraps back to minDate when it reaches maxDate.
  // Default: false.
  "loop": true,

  // Animation playback speed in frames per second.
  // Default: 0.5 (one frame every 2 seconds).
  "speed": 1,

  // ── Date display ─────────────────────────────────────────────────────────────

  // Format string for the date label shown alongside the date picker.
  // Available tokens: {dd} {mm} {yyyy} {h} {m} {s}
  // Omit to hide the label.
  "displayFormat": "{yyyy}-{mm}-{dd} {h}:{m}:{s}",

  // ── Step selector ────────────────────────────────────────────────────────────

  // Optional row of toggle buttons above the playback controls.
  // Each button sets the advance increment for ◄ ►, Play, and the slider snap.
  // The first entry is active by default.
  // When the user switches step, the current date is automatically re-snapped
  // to the start of the new step period (e.g. switching from PT10M to PT1H
  // moves 09:40 → 09:00; switching to P1D moves 09:40 → 00:00 UTC).
  // This ensures layers with nearestValue="0" always receive a valid grid date.
  // Omit to hide the step selector (the dimension's native step is used).
  "stepOptions": [
    { "label": "10 min", "value": "PT10M" },
    { "label": "1 hour", "value": "PT1H"  },
    { "label": "1 day",  "value": "P1D"   }
  ],

  // ── Layer behaviour ──────────────────────────────────────────────────────────

  // When true, the controlled layers are removed from the viewer's checked
  // (visible) set whenever the widget header is collapsed, and re-added when
  // it is expanded. Default: false.
  "hideLayerOnCollapse": false,

  // When true, shows the ScalarGIS legend widget for each visible controlled
  // layer inside the Timeline widget. Default: false.
  "showLegend": false
}
```

### Layer config requirements

Each layer listed in `layer_ids` must have the following field in its own
ScalarGIS layer config:

```jsonc
{
  "id": "frp_mtg",

  // Name of the OGC TIME dimension to look up in GetCapabilities.
  // Default: "time". Only needed if the server uses a different name.
  "dimension_name": "time",

  // Optional: pre-define the time extent to skip the GetCapabilities fetch.
  // Useful when the server is slow or the extent is already known.
  // Values format: "start/end/step" (single range) or
  //                "start/end/step,start/end/step,…" (multi-range, e.g. MODIS)
  "dimensions": [
    { "name": "time", "values": "2025-08-05T00:00:00Z/2026-04-17T14:30:00Z/PT10M" }
  ]
}
```

For **WMTS layers**, the layer identifier must be in `theme.layer` (singular),
matching the `ows:Identifier` value in the GetCapabilities document:

```jsonc
{
  "id": "era5land_wind_10m",
  "type": "WMTS",
  "dimension_name": "time",
  "layer": "reanalysis_era5_land/sfc-wind/wind",   // ← singular, not "layers"
  "url": "https://wmts.datastores.ecmwf.int/teroWmts/reanalysis_era5_land"
}
```

---

## Changes vs original

### 1. Multi-layer control (`layer_ids`)

**Original:** one primary layer (`layer_id`) plus optional extras (`extra_layer_ids`).

**Enhanced:** all layers are peers — no master layer. A new `layer_ids` array
lists all layers to control. All receive the same `TIME` value simultaneously.
The widget remains active as long as **any** of them is visible; it auto-collapses
when all are hidden and auto-expands when one becomes visible again.

The original `layer_id` / `extra_layer_ids` syntax is still accepted for
backward compatibility.

---

### 2. Union of TIME dimensions

**Original:** the TIME extent was read from one layer only.

**Enhanced:** `GetCapabilities` is fetched in parallel for all controlled layers
(`Promise.all`). The resulting dimension is the **union** of all individual
extents: `min(starts)`, `max(ends)`, smallest step (most granular). Each layer
still receives the exact value the user selects; servers that support
`nearestValue="1"` snap internally to their own grid.

---

### 3. Automatic periodic refresh (`refreshInterval`)

**Original:** GetCapabilities was fetched once at mount and never again.

**Enhanced:** an optional `refreshInterval` (seconds) triggers a silent
background re-fetch so that near-realtime feeds always expose their latest data
without a page reload. The current position is preserved across refreshes unless
it falls outside the refreshed range.

---

### 4. GetCapabilities timeout (`capabilitiesTimeout`)

**Original:** `fetch()` had no timeout — if a server was unreachable or a proxy
returned a delayed 504, the widget would stall for several minutes waiting for
the response before populating.

**Enhanced:** each GetCapabilities request is wrapped in an `AbortController`
with a configurable timeout (default 10 seconds). If a server does not respond
in time, the request is cancelled immediately and the widget populates with the
data from whichever servers did respond. The console shows a clear
`[Timeline] GetCapabilities timed out` message instead of a generic network
error.

---

### 5. WMTS support

**Original:** WMS only. WMTS layers caused `TypeError: updateParams is not a function`.

**Enhanced:**
- GetCapabilities is detected by `theme.type === "WMTS"` and parsed with
  the browser's `DOMParser` (the OL `WMSCapabilities` parser cannot read WMTS).
- Layer lookup uses `ows:Identifier` instead of `Name`.
- TIME updates use `source.updateDimensions({ time: value })` for WMTS and
  `source.updateParams({ TIME: value })` for WMS, with a URL-substitution
  fallback for older OL versions.
- **Important:** WMTS layer identifiers must be in `theme.layer` (singular).

---

### 6. WMTS GetFeatureInfo TIME injection (`FeatureInfo.js`)

**Original:** GetFeatureInfo requests for WMTS layers did not include the TIME
dimension — clicking the map always returned data for the server's default time,
not the time currently shown on screen.

**Enhanced:** `buildFeatureInfoWMTSUrl` and `buildFeatureInfoWMTSXYZUrl` in
`FeatureInfo.js` now read `source.getDimensions()` after building the base URL
and append all dimensions (including `time`) to the GetFeatureInfo request.
This works because the Timeline writes the current date via
`source.updateDimensions({ time: value })`, and `getDimensions()` returns
exactly that object. WMS GetFeatureInfo was already correct (OL includes
`updateParams` values automatically).

---

### 7. WMS 1.1.1 `<Extent>` support

**Original:** only handled `<Dimension name="time">` (WMS 1.3.0).

**Enhanced:** falls back to `<Extent name="time">` (WMS 1.1.1, e.g. Copernicus
Sentinel Hub) when the `<Dimension>` element is present but empty. Also walks
up the Layer element hierarchy to find dimensions inherited from parent groups.

---

### 8. Deep layer tree search (NASA GIBS)

**Original:** searched only one level of `Capability.Layer.Layer[]`.

**Enhanced:** `findWMSLayerRecursive()` walks the entire layer tree to any
depth. Fixes compatibility with NASA GIBS (1000+ layers across multiple
category groups).

---

### 9. Multi-range TIME values (NASA GIBS / MODIS)

**Original:** `parseTimeValues()` returned an empty array for the
comma-separated `start/end/step,start/end/step,…` format.

**Enhanced:** `parseWMSDimensionValues()` splits on commas first, then parses
each segment. The union finds `min(start)` and `max(end)` across all segments.

---

### 10. `nearestValue` awareness

**Original:** sent whatever date the user selected directly to the server.

**Enhanced:** reads the `nearestValue` attribute from each `<Dimension>` element
and adapts the client-side snap strategy:

| `nearestValue` | Client snap | Use case |
|---|---|---|
| `1` (default) | Round to nearest step boundary | Server accepts approximate dates |
| `0` | Floor to nearest step boundary | Server requires exact grid dates (e.g. IPMA FWI, IPMA MF2) |

When multiple layers have different `nearestValue` settings, the most
restrictive value (`0`) is applied to the union dimension.

---

### 11. `selectedIndex: "now"` with smart snapping

**Original:** supported `"first"`, `"last"`, and integer values only.

**Enhanced:** `"now"` positions the picker at the current moment, snapped to
the nearest step boundary and clamped to `[minDate, maxDate]`. For forecast
layers whose range is in the future, clamps to `minDate` (first forecast step).

---

### 12. Date / time picker replaces Dropdown

**Original:** a PrimeReact `Dropdown` populated with every date in the range —
unusable for large datasets (MODIS since 2000 at P1D ≈ 9 500 entries).

**Enhanced:** a native `<input type="date">` or `<input type="datetime-local">`
replaces the Dropdown. Type is selected automatically: sub-daily step →
`datetime-local`; daily or longer → `date`. Lightweight, accessible, no extra
dependencies.

---

### 13. Step selector UI (`stepOptions`)

**Original:** no user-facing step control.

**Enhanced:** optional row of toggle buttons. The active step affects ◄ ►,
Play, and the slider snap granularity.

When the user switches step, the current date is **automatically re-snapped**
to the start of the new step period:

| From | To PT1H | To P1D |
|---|---|---|
| 09:40 | → 09:00 | → 00:00 UTC |
| 14:27 | → 14:00 | → 00:00 UTC |

This ensures layers with `nearestValue="0"` always receive a valid grid date
immediately after a step change, without requiring the user to click ◄ or ►.

The slider and date picker also respect the active step — releasing the slider
snaps to the active step granularity, not the dimension's native step.

---

### 14. Range opacity for out-of-coverage layers

**Original:** stale cached tiles remained visible when navigating before a
layer's data start date.

**Enhanced:** `applyLayerRangeOpacity()` sets OL layer opacity to `0`
immediately when the selected date falls outside its pre-defined coverage range
(read from `dimensions[]` in the layer config). Restored as soon as the date
returns to range.

---

### 15. Drag & drop reorder fix

**Original:** reordering layers in the TOC via drag & drop caused the Timeline
to lose its connection to the moved layer — it would revert to showing the
server's default time.

**Enhanced:** the `useEffect` that resolves OL layer references now monitors
`layerOrderKey` — a string derived from the `children` arrays of all layer
groups. When a drag occurs, the ScalarGIS reducer updates the `children` array
of the parent group (not the top-level `layers` array), producing a new string
that React detects as a changed dependency. The OL layer refs are re-resolved
and TIME is immediately re-applied.

---

## Backward compatibility

The original single-layer config syntax (`layer_id`, `extra_layer_ids`,
`datasource.layer`) continues to work unchanged. Existing viewer configurations
require no modification unless you want to use the new features.
