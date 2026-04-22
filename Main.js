/**
 * Timeline — Main.js
 *
 * ScalarGIS plugin that places a temporal navigation controller on the map.
 * It drives one or more WMS / WMTS layers that expose an OGC TIME dimension,
 * keeping them all in sync as the user moves through time.
 *
 * ─── Key features ────────────────────────────────────────────────────────────
 *
 * Multi-layer control
 *   All layers listed in datasource.layer_ids receive the same TIME value.
 *   The widget stays active as long as at least one layer is visible; it
 *   collapses automatically when all controlled layers are hidden and expands
 *   again when any one of them is re-enabled.
 *
 * Union of time extents
 *   When multiple layers are configured, GetCapabilities is fetched for all of
 *   them in parallel (Promise.all). The resulting TIME dimension is the union
 *   of all individual extents: min of all starts, max of all ends, smallest
 *   step (most granular). Each layer still receives exactly the TIME value the
 *   user selects; servers with nearestValue="1" snap internally.
 *
 * Automatic GetCapabilities with periodic refresh
 *   The time extent is fetched from the server at startup. An optional
 *   refreshInterval (seconds) triggers a silent background re-fetch so that
 *   near-realtime feeds (e.g. MTG every 10 min, ERA5 every hour) always expose
 *   their latest data without a page reload. The current position is preserved
 *   across refreshes unless it falls outside the new range.
 *
 * Broad server compatibility
 *   • WMS 1.3.0  — <Dimension name="time">value</Dimension>
 *   • WMS 1.1.1  — <Extent name="time">value</Extent> (e.g. Sentinel Hub)
 *   • WMTS 1.0   — <Dimension><ows:Identifier>time</ows:Identifier>…</Dimension>
 *                  (e.g. ECMWF ERA5). WMTS layer identifier is read from
 *                  theme.layer (singular), not theme.layers.
 *   • Deep layer trees — recursive search handles servers that nest layers in
 *                  multiple group levels (e.g. NASA GIBS with 1000+ layers).
 *   • Multi-range — comma-separated start/end/step segments as used by NASA
 *                  GIBS: "2000-02-24/2000-04-25/P1D,2000-04-28/…".
 *
 * nearestValue awareness
 *   Reads the nearestValue attribute from each <Dimension> element.
 *   nearestValue="1" (default) → server accepts approximate dates and snaps
 *   internally; client rounds to the nearest step boundary.
 *   nearestValue="0" → server requires exact grid dates; client floors to the
 *   step boundary before sending the request (e.g. IPMA FWI, IPMA MF2).
 *   When multiple layers have different nearestValue settings, the most
 *   restrictive value (0) is applied to the union dimension.
 *
 * ─── Configuration reference (config_json) ───────────────────────────────────
 *
 * datasource.layer_ids       {string[]}  IDs of the ScalarGIS layers to
 *                                         control. All layers receive the same
 *                                         TIME value simultaneously.
 * datasource.layer_id        {string}    Legacy: single primary layer ID.
 * datasource.extra_layer_ids {string[]}  Legacy: additional layer IDs.
 *
 * selectedIndex  {string|number}
 *   "last"   Start at the most recent date in the dimension (default).
 *   "first"  Start at the earliest date.
 *   "now"    Start at the current moment, snapped to the nearest step
 *            boundary and clamped to [minDate, maxDate]. Useful for
 *            forecast layers (range in the future) and near-realtime
 *            feeds (MTG, ERA5). Snap rules by step magnitude:
 *              sub-hourly (e.g. PT10M) → floor to step boundary from epoch
 *              hourly                  → floor to current UTC hour
 *              daily                   → start of current UTC day
 *              monthly or longer       → first of current UTC month
 *   N (int)  Start at the Nth step from minDate (1-based).
 *
 * refreshInterval  {number}   Seconds between automatic GetCapabilities
 *                              refreshes. Recommended values:
 *                                600   — 10-minute feeds (MTG)
 *                                3600  — hourly feeds (ERA5)
 *                                86400 — daily feeds (MODIS)
 *                              Omit or set to 0 to disable.
 *
 * loop             {boolean}  Whether animation playback loops back to the
 *                              start when it reaches the end. Default: false.
 *
 * speed            {number}   Animation playback speed in frames per second.
 *                              Default: 0.5.
 *
 * displayFormat    {string}   Date label format string. Available tokens:
 *                              {dd} {mm} {yyyy} {h} {m} {s}
 *                              Example: "{dd}-{mm}-{yyyy} {h}:{m}:{s}"
 *
 * stepOptions      {object[]} Step buttons shown above the playback controls.
 *                              Each entry: { "label": string, "value": ISO8601duration }
 *                              The first entry is the default active step.
 *                              Affects ◄ ► buttons, the Play animation, and the
 *                              slider snap granularity.
 *                              Example:
 *                                [{"label":"10 min","value":"PT10M"},
 *                                 {"label":"1 hour","value":"PT1H"},
 *                                 {"label":"1 day", "value":"P1D"}]
 *
 * showLegend           {boolean}  Show layer legend(s) inside the widget.
 *                                  Default: false.
 *
 * hideLayerOnCollapse  {boolean}  When true, the controlled layers are removed
 *                                  from the checked/visible set whenever the
 *                                  widget header is collapsed. Default: false.
 *
 * ─── Layer config requirements ───────────────────────────────────────────────
 *
 * dimension_name  {string}   Name of the TIME dimension to look up in
 *                             GetCapabilities. Default: "time".
 *
 * dimensions      {object[]} Optional: pre-define the time extent to skip the
 *                             GetCapabilities fetch entirely.
 *                             Format: [{ "name": "time", "values": "start/end/step" }]
 *                             Example: [{ "name": "time",
 *                               "values": "2025-08-05T00:00:00Z/2026-04-17T14:30:00Z/PT10M" }]
 *
 * For WMTS layers the layer identifier must be in theme.layer (singular),
 * matching the ows:Identifier value in the WMTS GetCapabilities document.
 * For WMS layers use theme.layers (plural), as usual in ScalarGIS.
 *
 * ─── Example configuration ───────────────────────────────────────────────────
 *
 * {
 *   "id": "timeline",
 *   "type": "Timeline",
 *   "title": "Fire RGB + MODIS",
 *   "target": "map_controls_bottom_center",
 *   "config_json": {
 *     "datasource": { "layer_ids": ["frp_mtg", "modis_terra"] },
 *     "selectedIndex": "last",
 *     "refreshInterval": 600,
 *     "loop": true,
 *     "displayFormat": "{dd}-{mm}-{yyyy} {h}:{m}:{s}",
 *     "speed": 1,
 *     "stepOptions": [
 *       { "label": "10 min", "value": "PT10M" },
 *       { "label": "1 hour", "value": "PT1H"  },
 *       { "label": "1 day",  "value": "P1D"   }
 *     ]
 *   }
 * }
 */

import React, { useEffect, useState } from 'react';
import { v4 as uuidV4 } from 'uuid';
import { Button } from 'primereact/button';
import { Panel } from 'primereact/panel';
import TimelineControl from './TimelineControl';
import { WMSCapabilities } from 'ol/format';

/**
 * MainMenu — placeholder for a potential future sidebar entry.
 * The Timeline widget is placed directly on the map via
 * target: "map_controls_bottom_center".
 */
export function MainMenu({ className, config, actions, record }) {
  return (React.Fragment);
}

export default function Main(props) {

  const { as, core, config, utils, actions, record } = props;
  const { mainMap, viewer, dispatch, Models } = config;
  const { isUrlAppOrigin, isUrlAppHostname, removeUrlParam } = Models.Utils;

  const component_cfg = record.config_json || {};
  const recordTitle   = record.title;
  const header        = component_cfg.header || recordTitle || 'Timeline';

  // Widget starts collapsed; expands automatically when a controlled layer
  // becomes visible and collapses when all controlled layers are hidden.
  const [opened,    setOpened]    = useState(false);
  const [themes,    setThemes]    = useState([]);  // resolved ScalarGIS theme objects
  const [dimension, setDimension] = useState();    // union TIME dimension descriptor

  // ─── Layer ID resolution ─────────────────────────────────────────────────────

  /**
   * Returns the ordered list of ScalarGIS layer IDs to control.
   * Supports both the new array syntax (layer_ids) and the legacy
   * single-layer syntax (layer_id + optional extra_layer_ids).
   */
  function resolveLayerIds() {
    const ds = component_cfg?.datasource || {};
    if (ds.layer_ids && Array.isArray(ds.layer_ids) && ds.layer_ids.length) {
      return ds.layer_ids;
    }
    // Legacy fallback
    const ids = [];
    if (ds.layer_id) ids.push(ds.layer_id);
    if (ds.extra_layer_ids && Array.isArray(ds.extra_layer_ids))
      ds.extra_layer_ids.forEach(id => { if (!ids.includes(id)) ids.push(id); });
    return ids;
  }

  // ─── GetCapabilities URL builder ─────────────────────────────────────────────

  /**
   * Builds the GetCapabilities URL for a given theme, routing through the
   * ScalarGIS proxy when the URL is cross-origin, and appending an auth token
   * for internally authenticated services.
   */
  function buildCapabilitiesUrl(theme) {
    let url = theme.url;
    url = removeUrlParam(url, 'request');
    url = removeUrlParam(url, 'service');
    url = removeUrlParam(url, 'version');
    url = url + (url.indexOf('?') > -1 ? '' : '?');
    const isWMTS = (theme.type || '').toUpperCase() === 'WMTS';
    url += isWMTS
      ? '&SERVICE=WMTS&REQUEST=GetCapabilities'
      : '&SERVICE=WMS&REQUEST=GetCapabilities';
    if (theme?.version) url += '&VERSION=' + theme.version;
    if (isUrlAppHostname(url) && viewer.integrated_authentication) {
      const auth = viewer._auth;
      if (auth?.data?.auth_token) {
        const authkey = viewer?.integrated_authentication_key || 'authkey';
        url += '&' + authkey + '=' + auth.data.auth_token;
      }
    }
    if (!isUrlAppOrigin(url)) url = core.MAP_PROXY_URL + encodeURIComponent(url);
    return url;
  }

  // ─── Dimension value normalisation ───────────────────────────────────────────

  /**
   * Coerces a raw dimension values field to a plain string.
   * The OpenLayers WMSCapabilities parser occasionally returns the values
   * field as an array (observed with some WMTS responses); joining with a
   * comma produces the standard comma-separated multi-range format.
   */
  function normaliseDimensionValues(raw) {
    if (!raw) return null;
    if (Array.isArray(raw)) return raw.join(',');
    return String(raw);
  }

  // ─── Layer name / identifier resolution ──────────────────────────────────────

  /**
   * Resolves the WMS layer name from a ScalarGIS theme object.
   * Takes the first name when theme.layers is comma-separated.
   */
  function resolveWMSLayerName(theme) {
    const raw = theme.layers || theme.layer || theme.layerName || theme.LAYERS || '';
    return String(raw).split(',')[0].trim();
  }

  /**
   * Resolves the WMTS layer identifier from a ScalarGIS theme object.
   * ScalarGIS WMTS configs use theme.layer (singular) for the ows:Identifier,
   * confirmed with the ECMWF ERA5 WMTS service.
   * Falls back through several alternative field names for flexibility.
   */
  function resolveWMTSLayerIdentifier(theme) {
    const candidates = [
      theme.layer,       // primary: ScalarGIS WMTS layers use this field
      theme.layers,      // WMS-style fallback
      theme.layerName,
      theme.LAYER,
      theme.wmtsLayer,
      theme.identifier,
    ];
    const found = candidates.find(v => v != null && String(v).trim() !== '');
    return found != null ? String(found).trim() : null;
  }

  // ─── WMS layer tree search ────────────────────────────────────────────────────

  /**
   * Recursively searches an OpenLayers-parsed WMS layer tree for a node
   * whose Name matches layerName.
   *
   * The original implementation only searched one level deep, which failed
   * for servers that group layers into category hierarchies (e.g. NASA GIBS,
   * which nests its 1000+ layers under multiple category groups).
   *
   * @param {object} node       OL-parsed WMS layer node.
   * @param {string} layerName  WMS layer name to find (theme.layers).
   * @returns {object|null}     Matching layer node, or null if not found.
   */
  function findWMSLayerRecursive(node, layerName) {
    if (!node) return null;
    if (node.Name === layerName) return node;
    const children = node.Layer;
    if (Array.isArray(children)) {
      for (const child of children) {
        const found = findWMSLayerRecursive(child, layerName);
        if (found) return found;
      }
    } else if (children && typeof children === 'object') {
      return findWMSLayerRecursive(children, layerName);
    }
    return null;
  }

  // ─── GetCapabilities parsers ──────────────────────────────────────────────────

  /**
   * DOM-based WMS GetCapabilities parser used as a fallback when the
   * OpenLayers WMSCapabilities parser does not return dimension values.
   *
   * Handles:
   *   WMS 1.3.0 — <Dimension name="time" nearestValue="0|1">value</Dimension>
   *   WMS 1.1.1 — <Extent name="time">value</Extent>
   *               (e.g. Copernicus Sentinel Hub, where <Dimension> is empty
   *               and the actual values are in a sibling <Extent> element)
   *   Inherited — walks up the Layer element hierarchy to find dimensions
   *               defined on parent group layers.
   *
   * Also reads the nearestValue attribute so that TimelineControl can apply
   * strict client-side floor-snapping when the server requires exact dates.
   *
   * @param {string} xmlText        Raw GetCapabilities XML string.
   * @param {string} layerName      WMS layer name to look up.
   * @param {string} dimensionName  Dimension name to extract (typically "time").
   * @returns {{ name, values, nearestValue }|null}
   */
  function parseWMSCapabilitiesFallback(xmlText, layerName, dimensionName) {
    try {
      const doc = new DOMParser().parseFromString(xmlText, 'application/xml');

      // Find the Layer element whose direct child <Name> matches layerName.
      let targetLayer = null;
      for (const layer of doc.querySelectorAll('Layer')) {
        const nameEl = Array.from(layer.children).find(c => c.tagName === 'Name');
        if (nameEl && nameEl.textContent.trim() === layerName) {
          targetLayer = layer;
          break;
        }
      }

      if (!targetLayer) {
        console.warn(`[Timeline] WMS layer "${layerName}" not found in GetCapabilities`);
        return null;
      }

      // Walk up through the layer and its parent Layer elements so that
      // dimensions defined on a group layer are inherited by its children.
      let searchNode = targetLayer;
      while (searchNode && searchNode.tagName === 'Layer') {

        // WMS 1.3.0: dimension value is the text content of <Dimension>.
        for (const dim of searchNode.querySelectorAll(':scope > Dimension')) {
          if ((dim.getAttribute('name') || '').toLowerCase() === dimensionName.toLowerCase()) {
            const val = dim.textContent.trim();
            if (val) {
              const nv = dim.getAttribute('nearestValue');
              return {
                name: dimensionName,
                values: val,
                nearestValue: nv != null ? parseInt(nv, 10) : 1,
              };
            }
          }
        }

        // WMS 1.1.1: dimension value is in <Extent>; nearestValue is on the
        // accompanying (empty) <Dimension> element.
        for (const ext of searchNode.querySelectorAll(':scope > Extent')) {
          if ((ext.getAttribute('name') || '').toLowerCase() === dimensionName.toLowerCase()) {
            const val = ext.textContent.trim();
            if (val) {
              let nearestValue = 1; // default: assume server snaps
              for (const dim of searchNode.querySelectorAll(':scope > Dimension')) {
                if ((dim.getAttribute('name') || '').toLowerCase() === dimensionName.toLowerCase()) {
                  const nv = dim.getAttribute('nearestValue');
                  if (nv != null) nearestValue = parseInt(nv, 10);
                  break;
                }
              }
              return { name: dimensionName, values: val, nearestValue };
            }
          }
        }

        searchNode = searchNode.parentElement;
      }

      console.warn(`[Timeline] WMS dimension "${dimensionName}" not found in layer "${layerName}" or its parents`);
      return null;
    } catch (e) {
      console.warn('[Timeline] WMS DOM parse error:', e);
      return null;
    }
  }

  /**
   * OGC WMTS 1.0 GetCapabilities parser using the browser's DOMParser.
   * The OpenLayers WMSCapabilities parser cannot read WMTS documents because
   * WMTS uses OWS namespaces and a different XML structure.
   *
   * Locates the layer by ows:Identifier and collects all <Value> elements
   * within the matching <Dimension> (some servers return multiple <Value>
   * nodes for multi-range extents).
   *
   * WMTS does not define a nearestValue attribute; server-side snapping is
   * assumed (nearestValue = 1).
   *
   * @param {string} xmlText          Raw GetCapabilities XML string.
   * @param {string} layerIdentifier  WMTS layer identifier (ows:Identifier).
   * @param {string} dimensionName    Dimension name to extract (typically "time").
   * @returns {{ name, values, default, nearestValue }|null}
   */
  function parseWMTSCapabilities(xmlText, layerIdentifier, dimensionName) {
    try {
      if (!layerIdentifier) {
        console.warn('[Timeline] WMTS: layer identifier is null. Check theme.layer / theme.layers in config.');
        return null;
      }
      const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
      let targetLayer = null;
      for (const layer of doc.querySelectorAll('Contents > Layer')) {
        const id = layer.querySelector('Identifier');
        if (id && id.textContent.trim() === layerIdentifier) {
          targetLayer = layer;
          break;
        }
      }
      if (!targetLayer) {
        console.warn(`[Timeline] WMTS layer "${layerIdentifier}" not found in GetCapabilities`);
        return null;
      }
      for (const dim of targetLayer.querySelectorAll('Dimension')) {
        const dimId = dim.querySelector('Identifier');
        if (dimId && dimId.textContent.trim().toLowerCase() === dimensionName.toLowerCase()) {
          const valueEls  = dim.querySelectorAll('Value');
          const defaultEl = dim.querySelector('Default');
          if (valueEls.length > 0) {
            return {
              name: dimensionName,
              values: Array.from(valueEls).map(v => v.textContent.trim()).join(','),
              default: defaultEl ? defaultEl.textContent.trim() : undefined,
              nearestValue: 1, // WMTS servers always snap
            };
          }
        }
      }
      console.warn(`[Timeline] WMTS dimension "${dimensionName}" not found in layer "${layerIdentifier}"`);
      return null;
    } catch (e) {
      console.warn('[Timeline] WMTS parse error:', e);
      return null;
    }
  }

  // ─── Dimension fetching ───────────────────────────────────────────────────────

  /**
   * Fetches and parses the TIME dimension for a single ScalarGIS theme.
   *
   * Resolution order:
   *   1. Pre-defined dimensions[] in the layer config (fastest, no network request).
   *   2. WMTS GetCapabilities via DOMParser (for type: "WMTS" layers).
   *   3. OpenLayers WMSCapabilities parser (fast path for WMS).
   *   4. DOM-based WMS fallback parser (handles <Extent>, empty <Dimension>,
   *      inherited dimensions, deep trees).
   *
   * @param {object} theme  ScalarGIS layer/theme config object.
   * @returns {Promise<{ name, values, minDate, maxDate, step, nearestValue }|null>}
   */
  async function fetchThemeDimension(theme) {
    const dimensionName = theme.dimension_name || 'time';
    const isWMTS = (theme.type || '').toUpperCase() === 'WMTS';

    // 1. Fast path: pre-defined dimensions in layer config.
    if (theme?.dimensions?.length) {
      const dim = theme.dimensions.find(d => d.name === dimensionName);
      if (dim) return { nearestValue: 1, ...dim, values: normaliseDimensionValues(dim.values) };
    }

    const url = buildCapabilitiesUrl(theme);

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();

      // 2. WMTS path.
      if (isWMTS) {
        const layerIdentifier = resolveWMTSLayerIdentifier(theme);
        return parseWMTSCapabilities(text, layerIdentifier, dimensionName);
      }

      const layerName = resolveWMSLayerName(theme);

      // 3. OpenLayers WMS parser (fast path).
      try {
        const parser = new WMSCapabilities();
        const wms    = parser.read(text);
        const layer  = findWMSLayerRecursive(wms?.Capability?.Layer, layerName);
        if (layer) {
          let olDim = null;
          if (Array.isArray(layer?.Dimension)) {
            olDim = layer.Dimension.find(d => d.name === dimensionName) || null;
          } else if (layer?.Dimension?.name === dimensionName) {
            olDim = layer.Dimension;
          }
          if (olDim) {
            const values = normaliseDimensionValues(olDim.values);
            if (values) {
              // OL parser exposes nearestValue as a boolean; normalise to 0/1.
              const nearestValue = olDim.nearestValue != null ? (olDim.nearestValue ? 1 : 0) : 1;
              return { ...olDim, values, nearestValue };
            }
          }
        }
      } catch (_) { /* fall through to DOM fallback */ }

      // 4. DOM-based fallback (handles <Extent>, WMS 1.1.1, inherited dims).
      const fallback = parseWMSCapabilitiesFallback(text, layerName, dimensionName);
      if (fallback) return fallback;

      console.warn(`[Timeline] Could not extract dimension "${dimensionName}" for theme "${theme.id}"`);
      return null;

    } catch (error) {
      console.warn(`[Timeline] GetCapabilities failed for "${theme.id}":`, error.message);
      return null;
    }
  }

  // ─── Dimension value parsing ──────────────────────────────────────────────────

  /**
   * Parses a WMS TIME dimension values string into a structured descriptor.
   *
   * Handles three formats:
   *   Single range:  "2025-01-01T00:00:00Z/2026-04-17T14:30:00Z/PT10M"
   *   Multi-range:   "2000-02-24/2000-04-25/P1D,2000-04-28/2000-08-06/P1D,…"
   *                  (NASA GIBS / MODIS format — gaps indicate missing data)
   *   Date list:     "2024-01-01,2024-01-02,…"
   *
   * @param {string} valuesStr  Raw dimension values string.
   * @returns {{ type, … }|null}
   */
  function parseWMSDimensionValues(valuesStr) {
    if (!valuesStr) return null;
    const v = normaliseDimensionValues(valuesStr);
    const segments = v.split(',').map(s => s.trim()).filter(Boolean);
    const rangeSegments = [], dateSegments = [];
    segments.forEach(seg => {
      if (seg.includes('/')) {
        const parts = seg.split('/');
        if (parts.length === 3)
          rangeSegments.push({ start: parts[0].trim(), end: parts[1].trim(), step: parts[2].trim() });
      } else {
        dateSegments.push(seg);
      }
    });
    if (rangeSegments.length === 1 && dateSegments.length === 0) return { type: 'range',      ...rangeSegments[0] };
    if (rangeSegments.length > 0)                                 return { type: 'multirange', ranges: rangeSegments, extraDates: dateSegments };
    return { type: 'list', values: dateSegments };
  }

  /** Converts an ISO 8601 duration string to approximate seconds. */
  function durationToSeconds(d) {
    if (!d) return Infinity;
    const m = d.match(/P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?/);
    if (!m) return Infinity;
    const [, y=0, mo=0, w=0, dy=0, h=0, mi=0, s=0] = m.map(x => parseFloat(x)||0);
    return y*31536000 + mo*2592000 + w*604800 + dy*86400 + h*3600 + mi*60 + s;
  }

  /** Returns the shorter (more granular) of two ISO 8601 duration strings. */
  function smallerDuration(a, b) {
    return durationToSeconds(a) <= durationToSeconds(b) ? a : b;
  }

  // ─── Union dimension computation ─────────────────────────────────────────────

  /**
   * Computes the union TIME dimension from an array of individual layer
   * dimensions fetched from GetCapabilities.
   *
   * For range / multirange dimensions: takes min(start), max(end), and the
   * smallest (most granular) step across all layers.
   * For pure date lists: merges, sorts, and deduplicates.
   *
   * nearestValue of the union is the most restrictive across all layers:
   *   any layer with nearestValue=0 → union nearestValue=0 (exact dates required).
   *
   * @param {object[]} dimensions  Array of dimension objects from fetchThemeDimension.
   * @returns {{ name, values, minDate, maxDate, step, nearestValue }|null}
   */
  function computeUnionDimension(dimensions) {
    const parsed = dimensions.map(d => parseWMSDimensionValues(d?.values)).filter(Boolean);
    if (!parsed.length) return null;

    const allRanges = [], allListDates = [];
    parsed.forEach(p => {
      if      (p.type === 'range')      allRanges.push(p);
      else if (p.type === 'multirange') { allRanges.push(...p.ranges); allListDates.push(...(p.extraDates || [])); }
      else if (p.type === 'list')       allListDates.push(...p.values);
    });

    const unionNearestValue = dimensions.some(d => d.nearestValue === 0) ? 0 : 1;

    if (allRanges.length) {
      const starts = allRanges.map(r => new Date(r.start)).filter(d => !isNaN(d));
      const ends   = allRanges.map(r => new Date(r.end)).filter(d => !isNaN(d));
      allListDates.forEach(d => { const dt = new Date(d); if (!isNaN(dt)) { starts.push(dt); ends.push(dt); } });
      const minStart = new Date(Math.min(...starts));
      const maxEnd   = new Date(Math.max(...ends));
      const step     = allRanges.reduce((best, r) => smallerDuration(r.step, best), allRanges[0].step);
      return {
        name: 'time',
        values: `${minStart.toISOString()}/${maxEnd.toISOString()}/${step}`,
        minDate: minStart.toISOString(), maxDate: maxEnd.toISOString(),
        step, nearestValue: unionNearestValue,
      };
    }
    const unique = [...new Set(allListDates)].sort();
    return {
      name: 'time', values: unique.join(','),
      minDate: unique[0], maxDate: unique[unique.length - 1],
      nearestValue: unionNearestValue,
    };
  }

  /**
   * Extracts minDate, maxDate, and step from a single raw dimension object
   * (used when only one layer is configured so computeUnionDimension is not called).
   */
  function parseMinMaxFromSingle(dim) {
    const parsed = parseWMSDimensionValues(dim?.values);
    if (!parsed) return {};
    if (parsed.type === 'range') {
      return { minDate: parsed.start, maxDate: parsed.end, step: parsed.step };
    }
    if (parsed.type === 'multirange') {
      const starts = parsed.ranges.map(r => new Date(r.start));
      const ends   = parsed.ranges.map(r => new Date(r.end));
      const step   = parsed.ranges.reduce((b, r) => smallerDuration(r.step, b), parsed.ranges[0].step);
      return {
        minDate: new Date(Math.min(...starts)).toISOString(),
        maxDate: new Date(Math.max(...ends)).toISOString(),
        step,
      };
    }
    if (parsed.type === 'list' && parsed.values.length) {
      const sorted = [...parsed.values].sort();
      return { minDate: sorted[0], maxDate: sorted[sorted.length - 1] };
    }
    return {};
  }

  // ─── Dimension refresh ────────────────────────────────────────────────────────

  /**
   * Fetches TIME dimensions for all controlled themes in parallel, computes
   * the union, and updates the dimension state.
   * Called once at startup (via the themes effect) and then on each
   * refreshInterval tick.
   */
  async function refreshDimension(resolvedThemes) {
    if (!resolvedThemes?.length) return;
    const results = await Promise.all(resolvedThemes.map(t => fetchThemeDimension(t)));
    const valid   = results.filter(Boolean);
    if (!valid.length) {
      console.warn('[Timeline] No valid time dimensions found.');
      return;
    }
    const union = valid.length === 1
      ? { ...valid[0], ...parseMinMaxFromSingle(valid[0]) }
      : computeUnionDimension(valid);
    if (union) setDimension(union);
  }

  // ─── Effects ─────────────────────────────────────────────────────────────────

  // Resolve theme objects from layer IDs once the OL map is ready.
  // For the legacy inline-layer syntax (datasource.layer), creates a temporary
  // theme, registers it with the viewer, and marks it as visible.
  useEffect(() => {
    if (!mainMap) return;
    const layerIds = resolveLayerIds();
    if (!layerIds.length) {
      if (component_cfg?.datasource?.layer) {
        const _theme  = { id: String(uuidV4()), ...component_cfg.datasource.layer };
        const _parent = component_cfg?.datasource?.parent_id || 'main';
        dispatch(actions.viewer_add_themes(_parent, [_theme], true));
        dispatch(actions.layers_set_checked([...viewer.config_json.checked, _theme.id]));
        setThemes([_theme]);
      }
      return;
    }
    const resolved = layerIds
      .map(id => viewer.config_json.layers.find(l => l.id === id))
      .filter(Boolean);
    if (resolved.length) setThemes(resolved);
  }, [mainMap]);

  // Fetch TIME dimensions once themes are resolved, then set up the periodic
  // refresh timer if refreshInterval is configured.
  useEffect(() => {
    if (!mainMap || !themes.length) return;
    refreshDimension(themes);
    const refreshSecs = component_cfg?.refreshInterval;
    if (refreshSecs && Number.isFinite(refreshSecs) && refreshSecs > 0) {
      const timerId = setInterval(() => refreshDimension(themes), refreshSecs * 1000);
      return () => clearInterval(timerId);
    }
  }, [themes]);

  // When hideLayerOnCollapse is enabled, add/remove controlled layers from the
  // viewer's checked set as the widget header is toggled.
  useEffect(() => {
    if (!mainMap || !themes.length) return;
    if (component_cfg?.hideLayerOnCollapse !== true) return;
    let checked = [...viewer.config_json.checked];
    themes.forEach(theme => {
      if (opened) { if (!checked.includes(theme.id)) checked.push(theme.id); }
      else { checked = checked.filter(p => p !== theme.id); }
    });
    dispatch(actions.layers_set_checked(checked));
  }, [opened]);

  // Auto expand / collapse based on layer visibility.
  // The widget expands when any controlled layer becomes visible and collapses
  // when all controlled layers are hidden, keeping the map uncluttered.
  useEffect(() => {
    if (!themes?.length) return;
    const checked  = viewer?.config_json?.checked || [];
    const anyActive = themes.some(t => checked.includes(t.id));
    if (anyActive && !opened) setOpened(true);
    if (!anyActive && opened) setOpened(false);
  }, [viewer?.config_json?.checked]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  function renderContent() {
    // Prefer the explicit record.title; fall back to the first theme title.
    const displayTitle = recordTitle || themes[0]?.title || 'Timeline';
    return (
      <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '10px' }}>
        {/* Collapsible header button */}
        <Button
          style={{ width: '100%' }}
          className="p-button-warning"
          label={displayTitle}
          iconPos="right"
          icon={opened ? 'pi pi-angle-up' : 'pi pi-angle-down'}
          title={opened ? 'Minimise' : 'Expand'}
          onClick={() => setOpened(o => !o)}
        />
        {/* Time navigation controls */}
        <TimelineControl
          core={core}
          viewer={viewer}
          actions={actions}
          dispatch={dispatch}
          mainMap={mainMap}
          record={record}
          utils={utils}
          Models={Models}
          themes={themes}
          dimension={dimension}
          opened={opened}
          onCollapse={() => setOpened(false)}
        />
      </div>
    );
  }

  if (as === 'panel') return <Panel header={header}>{renderContent()}</Panel>;
  return renderContent();
}
