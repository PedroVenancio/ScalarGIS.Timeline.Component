/**
 * Timeline — TimelineControl.js
 *
 * Stateful React component that renders the time navigation UI and keeps
 * all controlled OpenLayers layers in sync with the selected date/time.
 *
 * Props
 * -----
 * core        ScalarGIS core object.
 * viewer      ScalarGIS viewer state (Redux).
 * mainMap     OpenLayers map instance.
 * dispatch    Redux dispatch function.
 * actions     ScalarGIS action creators.
 * record      Component config record (id, title, config_json, …).
 * utils       ScalarGIS utilities (findOlLayer, …).
 * Models      ScalarGIS model utilities.
 * themes      {object[]}  Resolved ScalarGIS theme objects to control.
 * dimension   {object}    Union TIME dimension descriptor produced by Main.js:
 *               { name, values, minDate, maxDate, step, nearestValue }
 * opened      {boolean}   Whether the widget body is visible.
 * onCollapse  {function}  Callback to collapse the parent header in Main.js.
 *
 * UI elements
 * -----------
 * Date / time picker
 *   Native <input type="datetime-local"> or <input type="date"> depending on
 *   whether the active step is sub-daily. The input is constrained to
 *   [minDate, maxDate] and the selected value is snapped to the step grid
 *   before being applied. The picker type switches automatically when the
 *   user changes the active step option.
 *
 * Slider
 *   Proportional slider across [minDate, maxDate]. Positions map to snapped
 *   dates: during drag the display updates live, on release the value is
 *   snapped to the nearest step grid point.
 *
 * Step selector
 *   Optional row of toggle buttons (configured via stepOptions in config_json)
 *   that set the advance increment for the ◄ ► buttons and the Play animation.
 *   The first option is active by default. Changing the active step also
 *   re-snaps the current date to the boundary of the new step period so that
 *   layers with nearestValue="0" always receive a valid grid date.
 *
 * Playback controls
 *   |◄  ◄  ▶/⏸  ►  ►|
 *   Jump-to-start / step-back / play-pause / step-forward / jump-to-end.
 *   The ◄ ► buttons advance by the active step (or the dimension's native
 *   step if no stepOptions are configured). Play cycles through time at the
 *   configured speed (frames per second), with optional looping.
 */

import React, { useEffect, useState, useRef } from 'react';

import { Button } from 'primereact/button';
import { Slider } from 'primereact/slider';
import { Legend } from '@scalargis/components';

import './style.css';


// ─── ISO 8601 duration helpers ────────────────────────────────────────────────

/**
 * Converts an ISO 8601 duration string to approximate seconds.
 * Month and year values use average lengths (30 and 365 days respectively).
 * Returns 0 for null / unparseable input.
 */
function durationToSeconds(d) {
  if (!d) return 0;
  const m = d.match(/P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?/);
  if (!m) return 0;
  const [, y=0, mo=0, w=0, dy=0, h=0, mi=0, s=0] = m.map(x => parseFloat(x) || 0);
  return y*31536000 + mo*2592000 + w*604800 + dy*86400 + h*3600 + mi*60 + s;
}

/** Adds an ISO 8601 duration to a Date and returns a new Date. */
function addDurationToDate(date, duration) {
  const m = duration.match(/P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?/);
  if (!m) return new Date(date);
  const [, y=0, mo=0, w=0, dy=0, h=0, mi=0, s=0] = m.map(x => parseFloat(x) || 0);
  const r = new Date(date);
  r.setFullYear(r.getFullYear() + y);
  r.setMonth(r.getMonth() + mo);
  r.setDate(r.getDate() + w*7 + dy);
  r.setHours(r.getHours() + h);
  r.setMinutes(r.getMinutes() + mi);
  r.setSeconds(r.getSeconds() + s);
  return r;
}

/** Subtracts an ISO 8601 duration from a Date and returns a new Date. */
function subtractDurationToDate(date, duration) {
  const m = duration.match(/P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?/);
  if (!m) return new Date(date);
  const [, y=0, mo=0, w=0, dy=0, h=0, mi=0, s=0] = m.map(x => parseFloat(x) || 0);
  const r = new Date(date);
  r.setFullYear(r.getFullYear() - y);
  r.setMonth(r.getMonth() - mo);
  r.setDate(r.getDate() - (w*7 + dy));
  r.setHours(r.getHours() - h);
  r.setMinutes(r.getMinutes() - mi);
  r.setSeconds(r.getSeconds() - s);
  return r;
}

// ─── Date snap helpers ────────────────────────────────────────────────────────

/**
 * Returns an ISO 8601 string (without sub-second precision) with a trailing Z.
 * Used throughout to produce clean TIME parameter values.
 */
function toISOZ(date) {
  return new Date(date).toISOString().split('.')[0] + 'Z';
}

/**
 * Snaps a target date to the nearest valid step boundary, respecting the
 * server's nearestValue preference.
 *
 * nearestValue = 1 (default, server snaps)
 *   Rounds to the nearest step boundary from minDate. The server accepts
 *   approximate values and returns the closest available data.
 *
 * nearestValue = 0 (exact match required)
 *   Floors to the step boundary, always choosing a date that is guaranteed
 *   to exist in the server's grid. Used by servers such as IPMA FWI and MF2
 *   that return an error for dates not present in their dimension list.
 *
 *   Example — step P1D, minDate 2026-04-19T00:00:00Z:
 *     13:00Z → 2026-04-19T00:00:00Z  (floor, not round)
 *     23:59Z → 2026-04-19T00:00:00Z  (still floor)
 *
 *   Example — step PT1H, minDate 2026-04-19T00:00:00Z:
 *     08:40Z → 2026-04-19T08:00:00Z  (floor to hour boundary)
 *
 * @param {string} targetDate  ISO date string to snap.
 * @param {object} dimension   Dimension descriptor with minDate, maxDate,
 *                             step, and nearestValue fields.
 * @returns {string}  Snapped ISO date string.
 */
function snapToNearest(targetDate, dimension) {
  if (!dimension || !targetDate) return targetDate;

  const target = new Date(targetDate);
  const { minDate, maxDate, step, nearestValue } = dimension;

  const min = minDate ? new Date(minDate) : null;
  const max = maxDate ? new Date(maxDate) : null;

  // Clamp to [min, max] before snapping.
  if (min && target < min) return toISOZ(min);
  if (max && target > max) return toISOZ(max);
  if (!step) return toISOZ(target);

  const stepMs = durationToSeconds(step) * 1000;
  if (stepMs <= 0) return toISOZ(target);

  const origin = min || new Date(0);
  const diff   = target.getTime() - origin.getTime();

  const snappedMs = nearestValue === 0
    ? Math.floor(diff / stepMs) * stepMs   // exact: floor
    : Math.round(diff / stepMs) * stepMs;  // server snaps: round

  const snapped = new Date(origin.getTime() + snappedMs);
  if (max && snapped > max) return toISOZ(max);
  if (min && snapped < min) return toISOZ(min);
  return toISOZ(snapped);
}

/**
 * Snaps a date to the start of the period defined by a given step duration.
 *
 * This is used when the user switches the active step option. If the current
 * date is 09:40 and the user switches from PT10M to PT1H, the date should
 * move to 09:00 (start of the current hour). If switching to P1D, it moves
 * to 00:00 UTC (start of the current day). This ensures that layers with
 * nearestValue="0" always receive a valid grid date immediately after a step
 * change, without requiring the user to click ◄ or ► first.
 *
 * The logic mirrors resolveNow() but uses an arbitrary input date instead
 * of the current moment.
 *
 * Examples (input: 2026-04-21T09:40:00Z):
 *   newStep PT10M → 2026-04-21T09:40:00Z  (already on grid, no change)
 *   newStep PT1H  → 2026-04-21T09:00:00Z  (floor to hour)
 *   newStep P1D   → 2026-04-21T00:00:00Z  (floor to day)
 *   newStep P1M   → 2026-04-01T00:00:00Z  (floor to month)
 *
 * @param {string} currentISO  Current date as ISO string.
 * @param {string} newStep     New step ISO 8601 duration (e.g. "PT1H", "P1D").
 * @param {object} dimension   Dimension descriptor (for min/max clamping).
 * @returns {string}  Re-snapped ISO date string.
 */
function snapToStepPeriodStart(currentISO, newStep, dimension) {
  if (!currentISO || !newStep) return currentISO;

  const d        = new Date(currentISO);
  const stepSecs = durationToSeconds(newStep);
  let   snapped;

  if (stepSecs >= 2592000) {
    // Monthly or longer: floor to first day of the current UTC month.
    snapped = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  } else if (stepSecs >= 86400) {
    // Daily: floor to midnight UTC of the current day.
    snapped = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  } else if (stepSecs >= 3600) {
    // Hourly: floor to the start of the current UTC hour.
    snapped = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
  } else {
    // Sub-hourly: floor to the nearest step boundary from Unix epoch.
    const stepMs = stepSecs * 1000;
    snapped = new Date(Math.floor(d.getTime() / stepMs) * stepMs);
  }

  // Clamp to dimension bounds.
  const min = dimension?.minDate ? new Date(dimension.minDate) : null;
  const max = dimension?.maxDate ? new Date(dimension.maxDate) : null;
  if (min && snapped < min) snapped = min;
  if (max && snapped > max) snapped = max;

  return toISOZ(snapped);
}

/**
 * Advances (or retreats) the current date by one step, clamping to
 * [minDate, maxDate] and snapping to the step grid.
 *
 * @param {string} currentISO  Current date as ISO string.
 * @param {object} dimension   Dimension descriptor.
 * @param {string} activeStep  Active step ISO 8601 duration (may differ from
 *                             dimension.step when a stepOption is selected).
 * @param {number} direction   +1 to advance, -1 to retreat.
 * @returns {string}  New date as ISO string.
 */
function advanceDate(currentISO, dimension, activeStep, direction) {
  const step = activeStep || dimension?.step;
  if (!step || !currentISO) return currentISO;
  const cur  = new Date(currentISO);
  const next = direction > 0
    ? addDurationToDate(cur, step)
    : subtractDurationToDate(cur, step);
  const min = dimension?.minDate ? new Date(dimension.minDate) : null;
  const max = dimension?.maxDate ? new Date(dimension.maxDate) : null;
  if (min && next < min) return toISOZ(min);
  if (max && next > max) return toISOZ(max);
  // Snap to ensure the result is always on the dimension grid.
  return snapToNearest(toISOZ(next), dimension);
}

// ─── Initial date resolution ──────────────────────────────────────────────────

/**
 * Computes the "now" snap date for selectedIndex: "now".
 *
 * Snaps the current UTC moment to the nearest step boundary, then clamps to
 * [min, max]. For forecast layers whose range starts in the future, "now"
 * will be before min and will therefore snap to min (the first forecast step).
 * For historical layers where "now" is after max, it snaps to max.
 *
 * Snap rules by step magnitude:
 *   sub-hourly (e.g. PT10M) → floor to step boundary from Unix epoch
 *   PT1H – PT23H            → floor to current UTC hour
 *   P1D                     → start of current UTC day
 *   P1M or longer           → first day of current UTC month
 */
function resolveNow(dim, min, max) {
  const now  = new Date();
  const step = dim?.step;
  let snapped;

  if (!step) {
    snapped = now;
  } else {
    const stepSecs = durationToSeconds(step);
    if (stepSecs >= 2592000) {
      snapped = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    } else if (stepSecs >= 86400) {
      snapped = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    } else if (stepSecs >= 3600) {
      snapped = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
    } else {
      const stepMs = stepSecs * 1000;
      snapped = new Date(Math.floor(now.getTime() / stepMs) * stepMs);
    }
  }

  if (min && snapped < min) snapped = min;
  if (max && snapped > max) snapped = max;
  return toISOZ(snapped);
}

/**
 * Resolves the initial date to display when the dimension first loads (or
 * when it refreshes and the current date falls outside the new range).
 *
 * @param {object} dim  Dimension descriptor.
 * @param {object} cfg  Component config_json.
 * @returns {string|null}  ISO date string, or null if dimension is missing.
 */
function resolveInitialDate(dim, cfg) {
  if (!dim) return null;
  const si  = cfg?.selectedIndex;
  const min = dim.minDate ? new Date(dim.minDate) : null;
  const max = dim.maxDate ? new Date(dim.maxDate) : null;

  if (si === 'first')                              return min ? toISOZ(min) : null;
  if (si === 'now')                                return resolveNow(dim, min, max);
  if (Number.isInteger(si) && dim.step && min) {
    let d = min;
    for (let i = 0; i < si - 1; i++) d = addDurationToDate(d, dim.step);
    if (max && d > max) d = max;
    return toISOZ(d);
  }
  // 'last' or default — most recent date.
  return max ? toISOZ(max) : null;
}

// ─── Slider helpers ───────────────────────────────────────────────────────────

/**
 * Maps a date to a slider integer position in [0, 1000].
 * The slider uses a fixed 0–1000 range regardless of the step count so that
 * it remains smooth even for very large ranges (e.g. ERA5 since 1950 at PT1H).
 * Snapping to the exact step grid happens on slide-end, not during drag.
 */
function dateToSlider(iso, minISO, maxISO) {
  if (!minISO || !maxISO) return 0;
  const t  = new Date(iso).getTime();
  const mn = new Date(minISO).getTime();
  const mx = new Date(maxISO).getTime();
  if (mx === mn) return 0;
  return Math.round(((t - mn) / (mx - mn)) * 1000);
}

/**
 * Maps a slider position [0, 1000] back to an ISO date string.
 * The result is not yet snapped; call snapToNearest after this.
 */
function sliderToDate(pos, minISO, maxISO) {
  const mn = new Date(minISO).getTime();
  const mx = new Date(maxISO).getTime();
  return toISOZ(new Date(mn + (pos / 1000) * (mx - mn)));
}

// ─── Date formatting ──────────────────────────────────────────────────────────

/**
 * Formats an ISO date string according to a template.
 * Available tokens: {dd} {mm} {yyyy} {h} {m} {s}
 * Returns an ISO string if no format is provided.
 */
function formatDate(val, format) {
  const d = new Date(val);
  if (isNaN(d)) return String(val);
  const dd   = d.getDate().toString().padStart(2, '0');
  const mm   = (d.getMonth() + 1).toString().padStart(2, '0');
  const yyyy = d.getFullYear();
  const h    = d.getHours().toString().padStart(2, '0');
  const mi   = d.getMinutes().toString().padStart(2, '0');
  const s    = d.getSeconds().toString().padStart(2, '0');
  if (format) {
    return format
      .replace('{dd}', dd).replace('{mm}', mm).replace('{yyyy}', yyyy)
      .replace('{h}', h).replace('{m}', mi).replace('{s}', s);
  }
  return d.toISOString();
}

/**
 * Converts an ISO date string to the value format expected by
 * <input type="datetime-local"> ("YYYY-MM-DDTHH:mm") or
 * <input type="date"> ("YYYY-MM-DD").
 */
function toInputValue(iso, hasTime) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const yyyy = d.getFullYear();
  const mm   = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd   = d.getDate().toString().padStart(2, '0');
  if (!hasTime) return `${yyyy}-${mm}-${dd}`;
  const h  = d.getHours().toString().padStart(2, '0');
  const mi = d.getMinutes().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${h}:${mi}`;
}

/** Returns true when the given ISO 8601 duration is shorter than one day. */
function hasSubDayStep(step) {
  if (!step) return false;
  const secs = durationToSeconds(step);
  return secs > 0 && secs < 86400;
}

// ─── OpenLayers layer TIME update ─────────────────────────────────────────────

/**
 * Updates the TIME parameter on an OpenLayers layer source.
 *
 * Supports three source types:
 *   TileWMS   — source.updateParams({ TIME: value })
 *   WMTS      — source.updateDimensions({ time: value })   (OL ≥ 6.x)
 *   Other     — URL substitution + source.refresh() as last resort
 *
 * @param {ol/layer/Base} layer      OpenLayers layer object.
 * @param {string}        timeValue  ISO 8601 date string.
 * @param {string}        themeType  ScalarGIS theme type ("WMS" | "WMTS").
 */
function updateLayerTime(layer, timeValue, themeType) {
  const source = layer.getSource();
  if (!source) return;

  if (typeof source.updateParams === 'function') {
    // TileWMS: standard WMS parameter update.
    source.updateParams({ TIME: timeValue });
    return;
  }
  if (typeof source.updateDimensions === 'function') {
    // WMTS: dimension update (note lowercase key "time").
    source.updateDimensions({ time: timeValue });
    return;
  }
  // Fallback: inject TIME into the URL and force a tile refresh.
  try {
    if (typeof source.setUrl === 'function') {
      const currentUrl = (source.getUrls ? source.getUrls()[0] : source.getUrl()) || '';
      const newUrl = currentUrl.replace(/TIME=[^&]*/i, `TIME=${encodeURIComponent(timeValue)}`);
      source.setUrl(newUrl.includes('TIME=') ? newUrl : `${newUrl}&TIME=${encodeURIComponent(timeValue)}`);
      source.refresh();
    }
  } catch (e) {
    console.warn('[Timeline] Could not update TIME on layer:', e);
  }
}

// ─── Layer range opacity ──────────────────────────────────────────────────────

/**
 * Fades out a layer when the current timeline position is outside its
 * pre-defined data coverage range.
 *
 * When multiple layers with different time extents are controlled together
 * (e.g. MTG from 2025-08 and MODIS from 2000), navigating before the MTG
 * start date would otherwise leave stale cached tiles visible on screen.
 * Setting opacity to 0 hides them immediately without a tile re-request.
 *
 * Only active when the layer config includes a dimensions[] array with
 * explicit start and end dates (the fast-path pre-defined extent).
 *
 * @param {ol/layer/Base} layer    OpenLayers layer object.
 * @param {string}        iso      Current timeline ISO date string.
 * @param {object}        theme    ScalarGIS theme config object.
 * @param {number}        opacity  Original layer opacity from theme config.
 */
function applyLayerRangeOpacity(layer, iso, theme, opacity) {
  if (!theme?.dimensions?.length) return;
  const dimensionName = theme.dimension_name || 'time';
  const dim = theme.dimensions.find(d => d.name === dimensionName);
  if (!dim?.values) return;

  const v = String(dim.values).trim();
  let minDate = null, maxDate = null;
  if (v.includes('/')) {
    const segments = v.split(',');
    const first    = segments[0].split('/');
    const last     = segments[segments.length - 1].split('/');
    if (first.length >= 1) minDate = new Date(first[0].trim());
    if (last.length >= 2)  maxDate = new Date(last[1].trim());
  }
  if (!minDate || !maxDate) return;

  const inRange       = new Date(iso) >= minDate && new Date(iso) <= maxDate;
  const targetOpacity = inRange ? opacity : 0;
  if (layer.getOpacity() !== targetOpacity) layer.setOpacity(targetOpacity);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TimelineControl({
  core, viewer, mainMap, dispatch, actions, record, utils, Models,
  themes,      // {object[]} resolved ScalarGIS theme objects
  dimension,   // {object}   union TIME dimension from Main.js
  opened,      // {boolean}  whether the widget body is expanded
  onCollapse,  // {function} callback to collapse the parent header
}) {
  const cfg           = record?.config_json || {};
  const displayFormat = cfg?.displayFormat;

  // currentDate is the source of truth for the selected position.
  // It is always an ISO string on the step grid (after snapping).
  const [currentDate, setCurrentDate] = useState(null);
  const [frameRate]                   = useState(cfg?.speed ?? 0.5);
  const [intervalId,  setIntervalId]  = useState(0);
  const [activeStep,  setActiveStep]  = useState(null);

  // controlLayers holds { layer, theme } pairs for all OL layers under control.
  const controlLayers = useRef([]);
  // intervalRef mirrors intervalId for use inside setInterval closures where
  // stale state would otherwise prevent clearing the timer.
  const intervalRef   = useRef(0);

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Returns true if at least one controlled layer is currently visible. */
  function anyLayerActive() {
    if (!themes?.length) return false;
    const checked = viewer?.config_json?.checked || [];
    return themes.some(t => checked.includes(t.id));
  }

  /** Returns the subset of themes that are currently visible (checked). */
  function activeThemes() {
    const checked = viewer?.config_json?.checked || [];
    return (themes || []).filter(t => checked.includes(t.id));
  }

  /**
   * Builds the step selector options array from config_json.stepOptions.
   * Returns an empty array when no stepOptions are configured (no selector shown).
   */
  function buildStepOptions() {
    const opts = cfg?.stepOptions;
    if (!Array.isArray(opts) || !opts.length) return [];
    return opts.map(o => ({ label: o.label || o.value, value: o.value }));
  }

  /**
   * Returns the currently active step duration.
   * Prefers the user-selected step button; falls back to the dimension's
   * native step; returns null if neither is available.
   */
  function effectiveStep() {
    return activeStep || dimension?.step || null;
  }

  // ─── Playback ────────────────────────────────────────────────────────────────

  /** Stops the running playback interval and resets interval state. */
  function stopPlay() {
    clearInterval(intervalRef.current);
    intervalRef.current = 0;
    setIntervalId(0);
  }

  /**
   * Starts the playback interval. Each tick advances currentDate by one
   * effectiveStep. When the end of the range is reached:
   *   loop: true  → wraps back to minDate
   *   loop: false → stops playback
   */
  function startPlay() {
    if (!dimension?.minDate || !dimension?.maxDate) return;
    const id = setInterval(() => {
      setCurrentDate(prev => {
        if (!prev) return prev;
        const step = effectiveStep();
        if (!step) return prev;
        const next = advanceDate(prev, dimension, step, +1);
        if (next === prev || new Date(next) >= new Date(dimension.maxDate)) {
          if (cfg?.loop === true) return toISOZ(new Date(dimension.minDate));
          stopPlay();
          return prev;
        }
        return next;
      });
    }, 1000 / frameRate);
    intervalRef.current = id;
    setIntervalId(id);
  }

  // ─── Effects ─────────────────────────────────────────────────────────────────

  // Resolve OpenLayers layer objects for all controlled themes.
  useEffect(() => {
    if (!mainMap || !themes?.length) return;
    controlLayers.current = themes
      .map(t => ({ layer: utils.findOlLayer(mainMap, t?.id), theme: t }))
      .filter(e => !!e.layer);
  }, [themes]);

  // Set the default active step from the first stepOption entry.
  useEffect(() => {
    const opts = buildStepOptions();
    if (opts.length) setActiveStep(opts[0].value);
  }, []);

  // When the dimension changes (initial load or periodic refresh):
  //   - If the current date is still within the new range, keep it.
  //   - Otherwise, resolve a new initial date from selectedIndex.
  useEffect(() => {
    if (!dimension) return;
    setCurrentDate(prev => {
      if (prev) {
        const prevMs = new Date(prev).getTime();
        const minMs  = dimension.minDate ? new Date(dimension.minDate).getTime() : -Infinity;
        const maxMs  = dimension.maxDate ? new Date(dimension.maxDate).getTime() : Infinity;
        if (prevMs >= minMs && prevMs <= maxMs) return prev;
      }
      return resolveInitialDate(dimension, cfg);
    });
  }, [dimension]);

  // Stop playback if all controlled layers become hidden.
  useEffect(() => {
    if (intervalId && !anyLayerActive()) stopPlay();
  }, [viewer?.config_json?.checked]);

  // Clean up the playback interval when the component unmounts.
  useEffect(() => () => clearInterval(intervalRef.current), []);

  // Apply the TIME parameter (and range opacity) to all OL layers whenever
  // currentDate changes. The value is snapped before sending to the server.
  useEffect(() => {
    if (!currentDate || !controlLayers.current.length) return;
    const snapped = snapToNearest(currentDate, dimension);
    controlLayers.current.forEach(({ layer, theme }) => {
      updateLayerTime(layer, snapped, theme.type);
      const originalOpacity = typeof theme.opacity === 'number' ? theme.opacity : 1;
      applyLayerRangeOpacity(layer, snapped, theme, originalOpacity);
    });
  }, [currentDate]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  // Nothing to show when the widget is collapsed.
  if (!opened) return <React.Fragment></React.Fragment>;

  // Compact info panel shown when all controlled layers are hidden.
  // Main.js collapses the header automatically in this case; this message
  // appears only if the user manually re-expands the collapsed header.
  if (!anyLayerActive()) {
    const names = (themes || []).map(t => t?.title || t?.id);
    return (
      <div style={{
        maxWidth: '320px',
        marginTop: '6px',
        padding: '8px 12px',
        borderRadius: '8px',
        background: '#EFF6FF',
        border: '1px solid #BFDBFE',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
      }}>
        <i className="pi pi-info-circle" style={{ color: '#3B82F6', marginTop: '2px', flexShrink: 0 }} />
        <div style={{ fontSize: '0.82em', color: '#1E40AF', lineHeight: '1.4', maxHeight: '5em', overflowY: 'auto' }}>
          {names.length === 1
            ? <>Layer <strong>{names[0]}</strong> is not visible</>
            : <>None of the controlled layers are visible:<br />{names.map((n, i) => <span key={i}>• {n}<br /></span>)}</>
          }
        </div>
      </div>
    );
  }

  const { minDate, maxDate, step: dimStep } = dimension || {};
  const step     = effectiveStep();
  const showTime = hasSubDayStep(step || dimStep); // true → datetime-local, false → date
  const stepOpts = buildStepOptions();
  const sliderVal = (currentDate && minDate && maxDate)
    ? dateToSlider(currentDate, minDate, maxDate)
    : 0;

  return (
    <div style={{ padding: '10px' }}>

      {/* Optional layer legends */}
      {cfg?.showLegend === true && activeThemes().map(theme => (
        <div key={theme.id} className="p-mb-2">
          <Legend data={theme} core={core} actions={actions} models={Models} />
        </div>
      ))}

      {/* ── Date / time picker ────────────────────────────────────────────── */}
      {/*
        Replaces the original Dropdown (which would contain thousands of entries
        for long-running services like MODIS since 2000 or ERA5 since 1950).
        Uses a native browser input which is lightweight, accessible, and renders
        the platform's own date/time picker UI.
        The type switches automatically:
          datetime-local — when the active step is sub-daily (e.g. PT10M, PT1H)
          date           — when the active step is one day or longer
        The selected value is always snapped to the step grid before being applied.
        Note: the date/time picker UI differs across browsers (Chrome shows a
        full datetime picker with a "Today" button; Firefox shows only a date
        calendar with the time editable as text). This is browser-native behaviour
        and cannot be changed without adding a third-party date picker library.
      */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
        <i className="pi pi-calendar" style={{ color: '#888' }} />
        <input
          type={showTime ? 'datetime-local' : 'date'}
          value={toInputValue(currentDate, showTime)}
          min={toInputValue(minDate, showTime)}
          max={toInputValue(maxDate, showTime)}
          style={{
            flex: 1,
            border: '1px solid #ced4da',
            borderRadius: '6px',
            padding: '5px 8px',
            fontSize: '0.9em',
            fontFamily: 'inherit',
            background: 'white',
            cursor: 'pointer',
          }}
          onChange={e => {
            if (!e.target.value) return;
            const parsed = new Date(e.target.value);
            if (isNaN(parsed)) return;
            // Snap with the active step so that manual date entry also respects
            // the currently selected step granularity.
            const snapDim = activeStep ? { ...dimension, step: activeStep } : dimension;
            setCurrentDate(snapToNearest(parsed.toISOString(), snapDim));
          }}
        />
        {/* Optional human-readable formatted label alongside the input */}
        {displayFormat && currentDate && (
          <span style={{ fontSize: '0.82em', color: '#555', whiteSpace: 'nowrap' }}>
            {formatDate(currentDate, displayFormat)}
          </span>
        )}
      </div>

      {/* ── Range slider ──────────────────────────────────────────────────── */}
      {/*
        Proportional slider across [minDate, maxDate] with a fixed 0–1000 range.
        During drag (onChange): updates the display live without snapping for a
        smooth feel. On release (onSlideEnd): snaps to the nearest step grid
        point using the active step (not the dimension's native step), so that
        the slider respects whichever step button the user has selected.
        Example: active step PT1H → releasing the slider always lands on a
        whole hour boundary, even if the dimension's native step is PT10M.
      */}
      <Slider
        className="p-mb-3"
        value={sliderVal}
        min={0}
        max={1000}
        onChange={e => {
          if (!minDate || !maxDate) return;
          setCurrentDate(sliderToDate(e.value, minDate, maxDate));
        }}
        onSlideEnd={e => {
          if (!minDate || !maxDate) return;
          // Build a temporary dimension view with the active step substituted
          // so that snapToNearest floors/rounds to the correct granularity.
          const snapDim = activeStep ? { ...dimension, step: activeStep } : dimension;
          setCurrentDate(snapToNearest(sliderToDate(e.value, minDate, maxDate), snapDim));
        }}
        disabled={!dimension}
      />

      {/* ── Step selector ─────────────────────────────────────────────────── */}
      {/*
        Optional row of toggle buttons defined via config_json.stepOptions.
        The active step controls the ◄ ► button increment and the Play
        animation cadence.

        When the user selects a new step, two things happen:
          1. Any running playback is stopped.
          2. The current date is re-snapped to the start of the corresponding
             period via snapToStepPeriodStart(). This ensures that layers with
             nearestValue="0" always receive a valid grid date immediately after
             a step change, without requiring the user to click ◄ or ► first.
             Example: current date 09:40, switching from PT10M to PT1H → 09:00;
             switching to P1D → 00:00 UTC of the same day.

        If no stepOptions are configured, this section is hidden.
      */}
      {stepOpts.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          marginBottom: '8px',
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '0.82em', color: '#666' }}>Step:</span>
          {stepOpts.map(opt => (
            <Button
              key={opt.value}
              label={opt.label}
              className={activeStep === opt.value ? 'p-button-sm p-button-warning' : 'p-button-sm p-button-outlined'}
              onClick={() => {
                if (intervalId) stopPlay();
                setActiveStep(opt.value);
                // Re-snap the current date to the start of the new step period.
                // This guarantees a valid grid date for nearestValue=0 servers
                // and makes the picker immediately reflect the new granularity.
                if (currentDate) {
                  setCurrentDate(snapToStepPeriodStart(currentDate, opt.value, dimension));
                }
              }}
              style={{ padding: '2px 10px', fontSize: '0.82em' }}
            />
          ))}
        </div>
      )}

      {/* ── Playback controls ─────────────────────────────────────────────── */}
      <div className="scalargis-timeline p-text-center">
        <div className="p-inputgroup scalargis-timeline">
          {/* Jump to start */}
          <Button
            icon="pi pi-angle-double-left"
            onClick={() => { stopPlay(); setCurrentDate(toISOZ(new Date(minDate))); }}
          />
          {/* Step back by activeStep */}
          <Button
            icon="pi pi-angle-left"
            onClick={() => { stopPlay(); setCurrentDate(prev => advanceDate(prev || minDate, dimension, effectiveStep(), -1)); }}
          />
          {/* Play / Pause */}
          {intervalId
            ? <Button icon="pi pi-pause" onClick={stopPlay} />
            : <Button icon="pi pi-play"  onClick={startPlay} />
          }
          {/* Step forward by activeStep */}
          <Button
            icon="pi pi-angle-right"
            onClick={() => { stopPlay(); setCurrentDate(prev => advanceDate(prev || minDate, dimension, effectiveStep(), +1)); }}
          />
          {/* Jump to end */}
          <Button
            icon="pi pi-angle-double-right"
            onClick={() => { stopPlay(); setCurrentDate(toISOZ(new Date(maxDate))); }}
          />
        </div>
      </div>

    </div>
  );
}
