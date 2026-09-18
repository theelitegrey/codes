import path from "node:path";
import fs from "node:fs";
import type { z } from "zod";
import { LLM } from "../../src/providers/llm/llm.js";
import type { AvatarVideoProvider, AvatarGenerationRequest, AvatarGenerationResult, AvatarCapabilities } from "../../src/providers/avatar/AvatarVideoProvider.js";
import type { ProviderHealth } from "../../src/providers/voice/VoiceProvider.js";
import { run, ffmpegBin, probe } from "../../src/media/ffmpeg.js";
import { ResearchResult, HookSet, Script, FactCheckResult, RetentionReview, Metadata } from "../../src/core/project.js";

/** Canned agent outputs so the pipeline can run without an API key. */
export class FakeLLM extends LLM {
  constructor() {
    super({ model: "fake", client: {} as never });
  }
  override async research(): Promise<string> {
    return "- A liquidity sweep is a fast move through an obvious swing high/low that triggers resting stop orders. [https://example.com/a]\n- After the sweep, price often reverses back into the prior range. [https://example.com/b]";
  }
  override async structured<S extends z.ZodType>(schema: S, system: string, _user: string): Promise<z.infer<S>> {
    const s = schema as unknown;
    if (s === ResearchResult) return { summary: "Liquidity sweeps: price runs stops beyond a swing point, then reverses.", key_facts: [{ fact: "Sweeps trigger resting stop orders beyond obvious highs/lows.", source: "https://example.com/a", confidence: "high" }, { fact: "A reclaim of the swept level is a common confirmation.", confidence: "medium" }], terminology: [{ term: "NQ", definition: "Nasdaq-100 E-mini futures" }], angles: ["stop hunts", "reclaim entries"] } as z.infer<S>;
    if (s === HookSet) return { hooks: [{ text: "Liquidity sweeps are not random. They are engineered.", style: "bold claim", rationale: "contrarian" }, { text: "Why NQ hunts your stops.", style: "question", rationale: "stakes" }, { text: "Stop getting swept.", style: "pattern interrupt", rationale: "short" }], selected_index: 0 } as z.infer<S>;
    if (s === Script) return { title_working: "NQ liquidity sweeps", hook: "Liquidity sweeps are not random. They are engineered.", beats: [{ narration: "Liquidity sweeps are not random. They are engineered.", purpose: "hook", visual_idea: "headline", est_seconds: 3 }, { narration: "Price runs above the old high, grabs the resting stops, then reverses hard.", purpose: "explanation", visual_idea: "candlestick chart with sweep", est_seconds: 5 }, { narration: "The tell is a fast reclaim of the level that just broke.", purpose: "example", visual_idea: "chart zoom", est_seconds: 4 }, { narration: "Wait for the reclaim before you act.", purpose: "payoff", visual_idea: "trader b-roll", est_seconds: 3 }, { narration: "Follow for more NQ breakdowns.", purpose: "cta", visual_idea: "cta card", est_seconds: 2 }], cta: "Follow for more NQ breakdowns.", estimated_total_seconds: 17 } as z.infer<S>;
    if (s === FactCheckResult) return { verdict: "pass", issues: [] } as z.infer<S>;
    if (s === RetentionReview) return { score: 78, predicted_drop_points: [], pacing_notes: "fine", approved: true, scene_adjustments: [{ scene_id: 4, text_overlay: "WAIT FOR THE RECLAIM" }] } as z.infer<S>;
    if (s === Metadata) return { title: "Why NQ hunts your stops", description: "A quick breakdown of liquidity sweeps.", caption: "Stop getting swept.", hashtags: ["#Shorts", "#NQ", "#trading"] } as z.infer<S>;
    // Visual plan
    if (system.includes("Visual Director")) {
      const candles = Array.from({ length: 30 }, (_, i) => { const b = 100 + Math.sin(i / 4) * 3 + (i > 20 ? -4 : 0) + (i === 20 ? 6 : 0); return [b, b + 1.5, b - 1.5, b + (i % 2 ? 0.8 : -0.8)] as [number, number, number, number]; });
      return {
        scenes: [
          { scene_id: 1, duration: 3, narration: "Liquidity sweeps are not random. They are engineered.", presenter: { enabled: true, position: "bottom", size: "medium", height_fraction: 0.45 }, main_visual: { type: "headline", headline: "Liquidity sweeps", subheadline: "Why price hunts stops", motion: "slow_zoom" }, text_overlay: "ENGINEERED", caption: "", music: "", sound_effect: "whoosh" },
          { scene_id: 2, duration: 5, narration: "Price runs above the old high, grabs the resting stops, then reverses hard.", presenter: { enabled: true, position: "bottom", size: "medium", height_fraction: 0.4 }, main_visual: { type: "chart", motion: "none", chart: { kind: "candlestick", title: "NQ 5m (illustrative)", series: candles, annotations: [{ index: 20, label: "sweep", level: 108, color: "#FF5A5A" }], animate: true } }, text_overlay: "STOP HUNT", caption: "", music: "", sound_effect: "" },
          { scene_id: 3, duration: 4, narration: "The tell is a fast reclaim of the level that just broke.", presenter: { enabled: false, position: "bottom", size: "medium" }, main_visual: { type: "chart", motion: "none", chart: { kind: "line", title: "Reclaim", series: candles.map((c) => c[3]), annotations: [{ index: 24, label: "reclaim", level: 104 }], animate: true } }, text_overlay: "THE RECLAIM", caption: "", music: "", sound_effect: "" },
          { scene_id: 4, duration: 3, narration: "Wait for the reclaim before you act.", presenter: { enabled: true, position: "bottom", size: "medium", height_fraction: 0.45 }, main_visual: { type: "broll", prompt: "trader watching screens", motion: "push_in" }, text_overlay: "", caption: "", music: "", sound_effect: "" },
          { scene_id: 5, duration: 2, narration: "Follow for more NQ breakdowns.", presenter: { enabled: true, position: "bottom", size: "large", height_fraction: 0.5 }, main_visual: { type: "graphic", headline: "Follow for more", motion: "none" }, text_overlay: "FOLLOW", caption: "", music: "", sound_effect: "" },
        ],
      } as z.infer<S>;
    }
    // Intake
    return { topic: "NQ liquidity sweeps", target_duration_sec: null, audience: null, language: null, extra_instructions: null } as z.infer<S>;
  }
}

/** Produces a synthetic landscape 25fps clip (ffmpeg testsrc) shaped like LongCat's output. */
export class FakeAvatarProvider implements AvatarVideoProvider {
  readonly name = "fake";
  capabilities(): AvatarCapabilities {
    return { audio_driven: true, resolutions: ["480p"], native_aspect_ratios: ["16:9"], fps: [25], max_duration_sec: 600, supports_negative_prompt: false, supports_seed: false, runtime: "local_gpu" };
  }
  async health(): Promise<ProviderHealth> {
    return { ok: true, detail: "fake avatar" };
  }
  async generate(req: AvatarGenerationRequest): Promise<AvatarGenerationResult> {
    fs.mkdirSync(req.outDir, { recursive: true });
    const out = path.join(req.outDir, "fake-avatar.mp4");
    const r = await run(ffmpegBin(), ["-y", "-f", "lavfi", "-i", `testsrc2=size=832x480:rate=25:duration=${Math.ceil(req.durationSec) + 1}`, "-vf", "drawbox=x=316:y=60:w=200:h=260:color=tan@1:t=fill", "-pix_fmt", "yuv420p", "-c:v", "libx264", out]);
    if (r.code !== 0) throw new Error(r.stderr);
    const info = await probe(out);
    return { path: out, width: 832, height: 480, fps: 25, duration_sec: info.duration_sec, provider: this.name, aspect_ratio: "16:9" };
  }
}
