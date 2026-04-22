# Timeline Component - Enhanced Edition

This is an enhanced version of the ScalarGIS `Timeline` component
(`packages/components/src/Timeline/src`).

The original source files are at:
- [Main.js](https://raw.githubusercontent.com/scalargis/scalargis-client/refs/heads/main/packages/components/src/Timeline/src/Main.js)
- [TimelineControl.js](https://raw.githubusercontent.com/scalargis/scalargis-client/refs/heads/main/packages/components/src/Timeline/src/TimelineControl.js)
- [config.example.json](https://raw.githubusercontent.com/scalargis/scalargis-client/refs/heads/main/packages/components/src/Timeline/src/config.example.json)
- [style.css](https://raw.githubusercontent.com/scalargis/scalargis-client/refs/heads/main/packages/components/src/Timeline/src/style.css)

---

## Changes vs original

### 1. Multi-layer control (`layer_ids`)

**Original:** one primary layer (`layer_id`) plus optional extras (`extra_layer_ids`).

**Enhanced:** all layers are peers — no master layer. A new `layer_ids` array
lists all layers to control. All receive the same `TIME` value simultaneously.
The widget remains active as long as **any** of them is visible; it auto-collapses
when all are hidden and auto-expands when one becomes visible again.

```json
"datasource": { "layer_ids": ["frp_mtg", "modis_terra", "era5land_wind"] }
```

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
it falls outside the refreshed range, in which case `selectedIndex` is applied.

```json
"refreshInterval": 600
```

---

### 4. WMTS support

**Original:** WMS only. WMTS layers caused `TypeError: updateParams is not a function`.

**Enhanced:**
- `GetCapabilities` is detected by `theme.type === "WMTS"` and parsed with
  the browser's `DOMParser` (the OpenLayers `WMSCapabilities` parser cannot
  read WMTS documents).
- Layer lookup uses `ows:Identifier` instead of `Name`.
- TIME updates use `source.updateDimensions({ time: value })` (WMTS) instead
  of `source.updateParams({ TIME: value })` (WMS), with a URL-substitution
  fallback for older OpenLayers versions.
- **Important:** WMTS layer identifiers must be in `theme.layer` (singular),
  not `theme.layers`, matching the `ows:Identifier` in the GetCapabilities
  document.

---

### 5. WMS 1.1.1 `<Extent>` support (Copernicus Sentinel Hub)

**Original:** only handled `<Dimension name="time">value</Dimension>` (WMS 1.3.0).

**Enhanced:** falls back to `<Extent name="time">value</Extent>` (WMS 1.1.1)
when the `<Dimension>` element is present but empty. Also walks up the Layer
element hierarchy to find dimensions inherited from parent group layers.

---

### 6. Deep layer tree search (NASA GIBS)

**Original:** searched only one level of `Capability.Layer.Layer[]`, failing
for servers that nest layers under category groups.

**Enhanced:** `findWMSLayerRecursive()` walks the entire layer tree to any
depth, finding the target layer regardless of nesting level. This fixes
compatibility with NASA GIBS (1000+ layers across multiple category groups).

---

### 7. Multi-range TIME values (NASA GIBS / MODIS)

**Original:** `parseTimeValues()` returned an empty array for the
comma-separated `start/end/step,start/end/step,…` format used by NASA GIBS.

**Enhanced:** `parseWMSDimensionValues()` splits on commas first, then parses
each segment individually. The union operation finds `min(start)` and `max(end)`
across all segments, so the slider covers the full historical extent even when
there are gaps (missing data periods) in the middle.

---

### 8. `nearestValue` awareness

**Original:** sent whatever date the user selected directly to the server.

**Enhanced:** reads the `nearestValue` attribute from each `<Dimension>` element
and adapts the client-side snap strategy:

| `nearestValue` | Behaviour |
|---|---|
| `1` (default) | Rounds to nearest step boundary; server accepts approximate values |
| `0` | Floors to nearest step boundary; server requires exact grid dates |

This fixes errors on servers such as IPMA FWI and IPMA MF2 that return HTTP
errors when sent a time with sub-step precision (e.g. `13:40Z` on a daily grid).

---

### 9. `selectedIndex: "now"` with smart snapping

**Original:** supported `"first"`, `"last"`, and integer values only.

**Enhanced:** a new `"now"` value positions the picker at the current moment,
snapped to the nearest step boundary and clamped to `[minDate, maxDate]`.

Snap rules by step magnitude:

| Step | Initial position |
|---|---|
| sub-hourly (e.g. `PT10M`) | Floor to step boundary from Unix epoch |
| `PT1H` – `PT23H` | Floor to current UTC hour |
| `P1D` | Start of current UTC day |
| `P1M` or longer | First day of current UTC month |

For forecast layers whose range is entirely in the future, `"now"` clamps to
`minDate` (the first available forecast step). For historical layers, it clamps
to `maxDate`.

---

### 10. Date / time picker replaces Dropdown

**Original:** a PrimeReact `Dropdown` populated with every date in the range.
This becomes unusable for large datasets (MODIS since year 2000 at `P1D` ≈ 9 500
entries; ERA5 since 1950 at `PT1H` ≈ 665 000 entries).

**Enhanced:** a native `<input type="date">` or `<input type="datetime-local">`
replaces the Dropdown. The type is selected automatically:
- Sub-daily step → `datetime-local` (date + time)
- Daily or longer step → `date` (date only)

The input is constrained to `[minDate, maxDate]` and snaps to the step grid on
change. This is lightweight, accessible, and renders the platform's native
picker UI with no additional dependencies.

---

### 11. Step selector UI (`stepOptions`)

**Original:** no user-facing step control.

**Enhanced:** an optional row of toggle buttons above the playback bar lets the
user switch the advance increment at runtime. The active step affects the ◄ ►
buttons, the Play animation, and the slider snap granularity.

```json
"stepOptions": [
  { "label": "10 min", "value": "PT10M" },
  { "label": "1 hour", "value": "PT1H"  },
  { "label": "1 day",  "value": "P1D"   }
]
```

---

### 12. Range opacity for out-of-coverage layers

**Original:** when navigating before a layer's data start date, stale cached
tiles would remain visible until the next zoom or pan.

**Enhanced:** `applyLayerRangeOpacity()` sets an OL layer's opacity to `0`
immediately when the selected date falls outside its pre-defined coverage range
(read from `dimensions[]` in the layer config). The opacity is restored as soon
as the date moves back into range.

This requires the layer config to include an explicit `dimensions[]` array.

---

### 13. `dimension_name` required on each layer

**Original:** relied on the now-removed `config_json.dimension.name` field.

**Enhanced:** each controlled layer must have `dimension_name: "time"` in its
own layer config. This allows different layers to expose dimensions under
different names if needed.

---

## Backward compatibility

The original single-layer config syntax (`layer_id`, `extra_layer_ids`,
`datasource.layer`) continues to work unchanged. Existing viewer configurations
require no modification unless you want to use the new features.
