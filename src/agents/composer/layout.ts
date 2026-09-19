import type { ComposerInputs, ComposerOverrides } from "./schema.js";
import { Z, type Layer, type MasterTimeline, type Rect, type SceneLayout } from "../../../remotion/composition/schema.js";
import { getModePreset } from "../../presets/modes.js";
import { DEFAULT_MOTION_THEME, type MotionTheme, type BeatMotion } from "../../../remotion/motion/schema.js";
import type { ShortMode } from "../../core/project.js";

export const SAFE = { top: 0.08, bottom: 0.14, side: 0.04 };

export interface BuildOptions {
  width: number;
  height: number;
  fps: number;
  /** Relative asset paths (from the project dir) for presenter/illustration. */
  presenterSrc?: { src: string; alpha: boolean; width: number; height: number };
  illustrationSrc: Record<string, { src: string; kind: "image" | "video" }>;
  overrides?: ComposerOverrides;
}

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Remap a time expressed on the script's planned beat windows onto the measured timeline. */
export function remap(t: number, planned: Array<{ id: string; start: number; end: number }>, measured: Map<string, { start: number; end: number }>): number {
  const b = planned.find((x) => t >= x.start && t < x.end) ?? planned[planned.length - 1];
  const m = measured.get(b.id);
  if (!m) return t;
  const f = (t - b.start) / Math.max(0.01, b.end - b.start);
  return m.start + Math.min(1, Math.max(0, f)) * (m.end - m.start);
}

/** Theme derived from the mode preset colours. */
export function themeForMode(mode: string): MotionTheme {
  const p = getModePreset(mode as ShortMode);
  const light = p.visual.background === "clean_light";
  return { ...DEFAULT_MOTION_THEME, accent: p.visual.accent_color, bg: light ? "#F7F7F5" : DEFAULT_MOTION_THEME.bg, fg: light ? "#111318" : DEFAULT_MOTION_THEME.fg, muted: light ? "#5B6170" : DEFAULT_MOTION_THEME.muted, font: p.captions.font_family };
}

/**
 * Builds the master timeline: one scene per beat on the measured clock,
 * default layers by z hierarchy, caption placement away from reserved rects.
 */
export function buildTimeline(inputs: ComposerInputs, o: BuildOptions): MasterTimeline {
  const { width: W, height: H } = o;
  const preset = getModePreset(inputs.brand.mode as ShortMode);
  const theme = themeForMode(inputs.brand.mode);
  const measured = new Map(inputs.audio_timeline.beats.map((b) => [b.beat_id, { start: b.start, end: b.end }]));
  const planned = inputs.script.beats.map((b) => ({ id: b.id, start: b.start, end: b.end }));
  const duration = inputs.audio_timeline.duration_sec + 0.3;
  const events: MasterTimeline["events"] = [{ t: 0, kind: "narration", detail: "narration starts" }];
  const safeTop = Math.round(H * SAFE.top);
  const safeBottom = Math.round(H * SAFE.bottom);
  const full: Rect = { x: 0, y: 0, w: W, h: H };

  // Presenter continuity: contiguous enabled spans so the host doesn't re-enter every scene.
  const presenterPlan = inputs.presenter?.plan;
  const scenes: SceneLayout[] = inputs.script.beats.map((beat, i) => {
    const m = measured.get(beat.id) ?? { start: beat.start, end: beat.end };
    const ov = o.overrides?.scenes.find((s) => s.beat_id === beat.id);
    const layers: Layer[] = [];
    const reserved: SceneLayout["reserved"] = [];
    layers.push({ id: `bg_${beat.id}`, type: "background", z: Z.background, start: m.start, end: m.end, rect: full, style: preset.visual.background, accent: preset.visual.accent_color, motion: preset.visual.camera_motion });

    // Presenter
    const pb = presenterPlan?.beats.find((b) => b.beat_id === beat.id);
    const presenterOn = Boolean(o.presenterSrc && pb?.presenter_enabled && !ov?.presenter_hidden);
    let presenterRect: Rect | null = null;
    if (presenterOn && pb && o.presenterSrc) {
      const scale = Math.min(0.9, Math.max(0.25, ov?.presenter_scale ?? pb.scale));
      const ph = Math.round(H * scale);
      presenterRect = pb.position === "top" ? { x: 0, y: 0, w: W, h: ph } : pb.position === "pip" ? { x: W - Math.round(W * 0.42) - 40, y: H - safeBottom - Math.round(W * 0.46), w: Math.round(W * 0.42), h: Math.round(W * 0.46) } : pb.position === "center" ? full : { x: 0, y: H - ph, w: W, h: ph };
      // Span: extend to neighbouring enabled scenes so the panel persists without re-animating.
      const prevOn = i > 0 && presenterPlan?.beats.find((b) => b.beat_id === inputs.script.beats[i - 1].id)?.presenter_enabled;
      const nextOn = i < inputs.script.beats.length - 1 && presenterPlan?.beats.find((b) => b.beat_id === inputs.script.beats[i + 1].id)?.presenter_enabled;
      layers.push({ id: `presenter_${beat.id}`, type: "presenter", z: Z.presenter, start: m.start, end: m.end, rect: presenterRect, src: o.presenterSrc.src, alpha: o.presenterSrc.alpha, src_width: o.presenterSrc.width, src_height: o.presenterSrc.height, focal: o.presenterSrc.height >= o.presenterSrc.width ? "50% 30%" : pb.camera === "close" ? "50% 15%" : "50% 22%", scale_boost: pb.camera === "close" ? 1.25 : pb.camera === "medium_close" ? 1.1 : 1, feather_px: o.presenterSrc.alpha ? 0 : 48, vignette: !o.presenterSrc.alpha, transition: prevOn ? "none" : "slide_up" });
      // Face zone ≈ upper 45 % of the panel, middle 60 % horizontally.
      reserved.push({ owner: "presenter_face", rect: { x: presenterRect.x + presenterRect.w * 0.2, y: presenterRect.y + presenterRect.h * 0.04, w: presenterRect.w * 0.6, h: presenterRect.h * 0.5 } });
      if (!prevOn) events.push({ t: m.start, kind: "presenter", detail: `presenter enters (${pb.position}, scale ${scale})` });
      if (!nextOn) events.push({ t: m.end, kind: "presenter", detail: "presenter leaves" });
    }

    // Caption band: a strip reserved for captions so they never sit on the chart or the face.
    const capH = inputs.captions ? Math.round(inputs.captions.style.font_size * inputs.captions.style.line_height * inputs.captions.style.max_lines + 40) : 0;
    const band = capH ? capH + 24 : 0;
    // Main visual panel: everything above the presenter (or the full safe frame), minus the caption band.
    const mainRect: Rect = presenterRect && pb?.position === "bottom" ? { x: 0, y: safeTop, w: W, h: presenterRect.y - safeTop - band } : presenterRect && pb?.position === "top" ? { x: 0, y: presenterRect.h + band, w: W, h: H - presenterRect.h - band - safeBottom } : { x: 0, y: safeTop, w: W, h: H - safeTop - safeBottom - band };

    // Illustration (z 10)
    const ill = o.illustrationSrc[beat.id];
    if (ill) {
      layers.push({ id: `ill_${beat.id}`, type: "illustration", z: Z.illustration, start: m.start, end: m.end, rect: mainRect, src: ill.src, kind: ill.kind, fit: "cover", motion: "slow_zoom", mask: presenterRect ? "fade_bottom" : "none" });
      events.push({ t: m.start, kind: "illustration", detail: `${ill.kind} ${ill.src}` });
    }

    // Motion graphics (z 30; charts z 20 inside the beat stage)
    const mb = inputs.motion?.beats.find((b) => b.beat_id === beat.id);
    if (mb) {
      const remapped: BeatMotion = remapBeat(mb, m);
      const hasChart = remapped.layers.some((l) => l.kind === "CandlestickChart");
      layers.push({ id: `motion_${beat.id}`, type: "motion", z: hasChart ? Z.chart : Z.motion, start: m.start, end: m.end, rect: mainRect, beat: remapped });
      reserved.push({ owner: "motion", rect: hasChart ? mainRect : { x: mainRect.x, y: mainRect.y + mainRect.h * 0.15, w: mainRect.w, h: mainRect.h * 0.7 } });
      events.push({ t: m.start, kind: "motion", detail: `${remapped.layers.map((l) => l.kind).join("+")} — ${remapped.concept}` });
    }

    // Text (z 50)
    for (const e of inputs.text?.elements.filter((x) => x.beat_id === beat.id && !ov?.drop_text_ids.includes(x.id)) ?? []) {
      const start = remap(e.start, planned, measured);
      const end = remap(e.end, planned, measured);
      const rect = textRect(e.position, mainRect, presenterRect, W, H, safeTop, safeBottom, e.level);
      layers.push({ id: `text_${e.id}`, type: "text", z: Z.text, start, end: Math.max(end, start + 0.8), rect, element: { ...e, start, end: Math.max(end, start + 0.8) }, font_scale: 1 });
      if (e.level <= 2) reserved.push({ owner: `text_${e.id}`, rect });
      events.push({ t: start, kind: "text", detail: `${e.type} "${e.text}"` });
    }

    // Captions (z 60): pick a free slot.
    let captionRect: Rect | null = null;
    if (inputs.captions) {
      const slots: Array<{ name: string; rect: Rect }> = [];
      const sideX = Math.round(W * SAFE.side);
      const bandW = W - sideX * 2;
      if (presenterRect && pb?.position === "bottom") slots.push({ name: "above_presenter", rect: { x: sideX, y: presenterRect.y - capH - 12, w: bandW, h: capH } });
      if (presenterRect && pb?.position === "top") slots.push({ name: "top_third", rect: { x: sideX, y: presenterRect.h + 12, w: bandW, h: capH } });
      slots.push({ name: "lower_third", rect: { x: sideX, y: H - safeBottom - capH - 20, w: bandW, h: capH } });
      slots.push({ name: "top_third", rect: { x: sideX, y: safeTop + 20, w: bandW, h: capH } });
      slots.push({ name: "center", rect: { x: sideX, y: Math.round(H * 0.5 - capH / 2), w: bandW, h: capH } });
      const pref = ov?.caption_slot && ov.caption_slot !== "auto" ? ov.caption_slot : inputs.captions.style.preferred_position;
      // Faces weigh far more than any other reserved area.
      const scored = slots.map((s) => ({ s, overlap: reserved.reduce((a, r) => a + overlapArea(s.rect, r.rect) * (r.owner === "presenter_face" ? 10 : 1), 0), pref: s.name === pref ? 0 : 1 })).sort((a, b) => a.overlap - b.overlap || a.pref - b.pref);
      captionRect = scored[0].s.rect;
      const cues = inputs.captions.cues.filter((c) => c.end > m.start && c.start < m.end);
      if (cues.length) layers.push({ id: `cap_${beat.id}`, type: "caption", z: Z.caption, start: m.start, end: m.end, rect: captionRect, cues, style: inputs.captions.style });
      if (scored[0].overlap > 0) events.push({ t: m.start, kind: "caption", detail: `captions moved to ${scored[0].s.name} (overlap ${Math.round(scored[0].overlap)}px²)` });
    }

    if (ov?.effect && ov.effect !== "none") layers.push({ id: `fx_${beat.id}`, type: "effect", z: Z.effect, start: m.start, end: Math.min(m.end, m.start + 0.4), rect: full, effect: ov.effect, intensity: 0.5 });

    // Motion-plan-driven transitions; override wins.
    const transition = ov?.transition_in ?? (mb?.transition_in === "none" ? "cut" : (mb?.transition_in as SceneLayout["transition_in"]) ?? (i === 0 ? "cut" : preset.visual.transitions === "slide" ? "slide_left" : preset.visual.transitions === "cut" ? "cut" : preset.visual.transitions));
    events.push({ t: m.start, kind: "scene", detail: `scene ${i + 1} (${beat.id}) ${transition}` });
    return { scene: i + 1, beat_id: beat.id, start: m.start, end: m.end, duration: m.end - m.start, transition_in: transition, reserved, caption_rect: captionRect, layers };
  });

  // SFX events from the audio timeline for the human-readable log.
  for (const s of inputs.audio_timeline.sfx) events.push({ t: s.at, kind: "sfx", detail: s.type });
  events.sort((a, b) => a.t - b.t);
  return { width: W, height: H, fps: o.fps, duration, audio_src: inputs.master_audio, theme, scenes, events };
}

/** Shift a beat's motion plan from its planned window to the measured one. */
export function remapBeat(mb: BeatMotion, m: { start: number; end: number }): BeatMotion {
  const f = (t: number) => m.start + ((t - mb.start) / Math.max(0.01, mb.end - mb.start)) * (m.end - m.start);
  return {
    ...mb,
    start: m.start,
    end: m.end,
    layers: mb.layers.map((l) => {
      const base = { ...l, start: f(l.start), end: f(l.end) };
      if (l.kind === "CandlestickChart") return { ...base, kind: l.kind, overlays: l.overlays.map((o) => ({ ...o, start: f(o.start), end: f(o.end) })) } as BeatMotion["layers"][number];
      if (l.kind === "Timeline") return { ...base, kind: l.kind, steps: l.steps.map((s) => ({ ...s, at: f(s.at) })) } as BeatMotion["layers"][number];
      return base as BeatMotion["layers"][number];
    }),
  };
}

function textRect(position: string, main: Rect, presenter: Rect | null, W: number, H: number, safeTop: number, safeBottom: number, level: number): Rect {
  const h = level === 1 ? 180 : level === 2 ? 120 : 90;
  const pad = Math.round(W * SAFE.side);
  const colW = Math.round(W * 0.6);
  const xFor = (pos: string) => (pos.endsWith("left") ? pad : pos.endsWith("right") ? W - pad - colW : Math.round((W - colW) / 2));
  const wFor = (pos: string) => (pos.endsWith("center") ? W - pad * 2 : colW);
  if (position === "above-presenter") return { x: pad, y: (presenter ? presenter.y : H - safeBottom) - h - 12, w: W - pad * 2, h };
  if (position === "lower-third") return { x: pad, y: H - safeBottom - h - 20, w: W - pad * 2, h };
  if (position.startsWith("top")) return { x: xFor(position), y: main.y + 16, w: wFor(position), h };
  if (position.startsWith("middle") || position === "center") return { x: xFor(position), y: main.y + Math.round(main.h / 2 - h / 2), w: wFor(position), h };
  return { x: xFor(position), y: main.y + main.h - h - 16, w: wFor(position), h }; // bottom-*
}

export { intersects };
