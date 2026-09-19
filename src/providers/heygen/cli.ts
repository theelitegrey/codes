import fs from "node:fs";
import path from "node:path";
import { env, envInt } from "../../core/env.js";
import { log } from "../../core/log.js";
import { commandExists, run, ensureDir } from "../../media/ffmpeg.js";

/**
 * HeyGen CLI transport — the surface HeyGen itself tells agents to use.
 *
 * Their published skills (github.com/heygen-com/skills, heygen-video v3.2.0)
 * state plainly: "v3 only — never call v1 or v2 endpoints", and list
 * `POST /v1/video.generate`, `POST /v2/video/generate`, `GET /v2/avatars`
 * and `GET /v1/avatar.list` as deprecated. The supported surfaces are the
 * HeyGen MCP server, the OpenClaw plugin, and this CLI:
 *
 *   curl -fsSL https://static.heygen.ai/cli/install.sh | bash
 *   export HEYGEN_API_KEY=...        # or: heygen auth login
 *
 * Contract (verbatim from that skill): JSON on stdout, an
 * `{error:{code,message,hint}}` envelope on stderr, exit codes
 * 0 ok · 1 API · 2 usage · 3 auth · 4 timeout, and `--wait` on creation
 * commands blocks until completion instead of hand-rolling a poll loop.
 *
 * Command groups: `video-agent {create,get,send,stop,styles,resources,videos}`,
 * `video {get,list,download,delete}`, `avatar {list,get,consent,create,looks}`,
 * `voice {list,create,speech}`, `video-translate {create,get,languages}`,
 * `lipsync {create,get}`, `asset create`, `user me get`, `auth {login,logout,status}`.
 *
 * Flag names for the commands this pipeline drives are kept in FLAGS below
 * and are overridable by env, because `heygen <noun> <verb> --help` is the
 * authoritative reference and it lives on the user's machine, not here. Run
 * `shorts heygen probe` to print the real help for each command.
 */
export const FLAGS = {
  voiceSpeechText: env("HEYGEN_FLAG_SPEECH_TEXT", "--text")!,
  voiceSpeechVoice: env("HEYGEN_FLAG_SPEECH_VOICE", "--voice-id")!,
  voiceSpeechInputType: env("HEYGEN_FLAG_SPEECH_INPUT_TYPE", "--input-type")!,
  voiceSpeechLanguage: env("HEYGEN_FLAG_SPEECH_LANGUAGE", "--language")!,
  voiceSpeechLocale: env("HEYGEN_FLAG_SPEECH_LOCALE", "--locale")!,
  voiceSpeechSpeed: env("HEYGEN_FLAG_SPEECH_SPEED", "--speed")!,
  assetFile: env("HEYGEN_FLAG_ASSET_FILE", "--file")!,
  lipsyncAvatar: env("HEYGEN_FLAG_LIPSYNC_AVATAR", "--avatar-id")!,
  lipsyncAudioAsset: env("HEYGEN_FLAG_LIPSYNC_AUDIO_ASSET", "--audio-asset-id")!,
  lipsyncAudioUrl: env("HEYGEN_FLAG_LIPSYNC_AUDIO_URL", "--audio-url")!,
  avatarLooksGroup: env("HEYGEN_FLAG_LOOKS_GROUP", "--group-id")!,
  videoDownloadOut: env("HEYGEN_FLAG_VIDEO_OUT", "--output")!,
} as const;

export interface HeyGenCliError {
  code?: string;
  message: string;
  hint?: string;
  exitCode: number;
  help?: string;
}

export class HeyGenCliException extends Error {
  constructor(readonly detail: HeyGenCliError) {
    super(detail.message);
    this.name = "HeyGenCliException";
  }
}

/** Anything the CLI returns: `data` unwrapped when present. */
const unwrap = <T>(j: unknown): T => {
  const o = j as { data?: T };
  return o && typeof o === "object" && "data" in o && o.data != null ? (o.data as T) : (j as T);
};

export class HeyGenCli {
  readonly bin: string;
  private readonly timeoutMs: number;

  constructor(bin?: string, timeoutMs?: number) {
    this.bin = bin ?? env("HEYGEN_CLI", "heygen")!;
    this.timeoutMs = timeoutMs ?? envInt("HEYGEN_CLI_TIMEOUT_MS", 30 * 60_000);
  }

  async installed(): Promise<boolean> {
    if (!(await commandExists(this.bin))) return false;
    const r = await run(this.bin, ["--version"]);
    return r.code === 0;
  }

  async version(): Promise<string> {
    const r = await run(this.bin, ["--version"]);
    return r.stdout.trim() || r.stderr.trim();
  }

  /** `heygen <args> --help`, used by the probe and to explain usage errors. */
  async help(args: string[]): Promise<string> {
    const r = await run(this.bin, [...args, "--help"]);
    return (r.stdout + r.stderr).trim();
  }

  /** Run a command and parse its JSON stdout. Throws HeyGenCliException with the CLI's own error envelope. */
  async json<T = unknown>(args: string[], opts: { onLine?: (l: string) => void } = {}): Promise<T> {
    log.info(`heygen ${args.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}`);
    const r = await run(this.bin, args, { onLine: opts.onLine, env: { HEYGEN_API_KEY: env("HEYGEN_API_KEY") ?? "" } });
    if (r.code !== 0) {
      let detail: HeyGenCliError = { message: r.stderr.trim() || `heygen exited ${r.code}`, exitCode: r.code };
      try {
        const e = (JSON.parse(r.stderr) as { error?: { code?: string; message?: string; hint?: string } }).error;
        if (e) detail = { code: e.code, message: e.message ?? detail.message, hint: e.hint, exitCode: r.code };
      } catch {
        /* stderr was not JSON */
      }
      // Exit code 2 is a usage error: the flag names below drifted from the CLI. Attach the real help.
      if (r.code === 2) detail.help = await this.help(args.slice(0, 2));
      throw new HeyGenCliException(detail);
    }
    const out = r.stdout.trim();
    if (!out) return undefined as T;
    try {
      return unwrap<T>(JSON.parse(out));
    } catch {
      throw new HeyGenCliException({ message: `heygen returned non-JSON stdout: ${out.slice(0, 300)}`, exitCode: 0 });
    }
  }

  // ---- operations this pipeline uses ----------------------------------------
  async userMe(): Promise<Record<string, unknown>> {
    return this.json(["user", "me", "get"]);
  }

  async voiceList(): Promise<Array<Record<string, unknown>>> {
    const d = await this.json<Array<Record<string, unknown>> | { voices?: Array<Record<string, unknown>> }>(["voice", "list"]);
    return Array.isArray(d) ? d : (d?.voices ?? []);
  }

  /** `heygen voice speech create --text … --voice-id … --input-type text --language en --locale en-US` */
  async voiceSpeechCreate(o: { text: string; voiceId: string; inputType?: "text" | "ssml"; language?: string; locale?: string; speed?: number }): Promise<Record<string, unknown>> {
    const args = ["voice", "speech", "create", FLAGS.voiceSpeechText, o.text, FLAGS.voiceSpeechVoice, o.voiceId, FLAGS.voiceSpeechInputType, o.inputType ?? "text"];
    if (o.language) args.push(FLAGS.voiceSpeechLanguage, o.language);
    if (o.locale) args.push(FLAGS.voiceSpeechLocale, o.locale);
    if (o.speed !== undefined && o.speed !== 1) args.push(FLAGS.voiceSpeechSpeed, String(o.speed));
    return this.json(args);
  }

  /** `heygen asset create --file <path>` (max 32 MB). */
  async assetCreate(file: string): Promise<Record<string, unknown>> {
    const size = fs.statSync(file).size;
    if (size > 32 * 1024 * 1024) throw new HeyGenCliException({ message: `${path.basename(file)} is ${(size / 1e6).toFixed(1)} MB; HeyGen assets are capped at 32 MB`, exitCode: 2 });
    return this.json(["asset", "create", FLAGS.assetFile, file]);
  }

  async avatarList(): Promise<Array<Record<string, unknown>>> {
    const d = await this.json<Array<Record<string, unknown>> | { avatars?: Array<Record<string, unknown>> }>(["avatar", "list"]);
    return Array.isArray(d) ? d : (d?.avatars ?? []);
  }

  /** `heygen avatar looks list --group-id <id>`; a look is ready when preview_image_url is set and image_width/height are non-zero. */
  async avatarLooks(groupId: string): Promise<Array<Record<string, unknown>>> {
    const d = await this.json<Array<Record<string, unknown>> | { looks?: Array<Record<string, unknown>> }>(["avatar", "looks", "list", FLAGS.avatarLooksGroup, groupId]);
    return Array.isArray(d) ? d : (d?.looks ?? []);
  }

  async waitForLookReady(groupId: string, o: { intervalMs?: number; timeoutMs?: number } = {}): Promise<Record<string, unknown>> {
    const interval = o.intervalMs ?? envInt("HEYGEN_POLL_INTERVAL_MS", 10_000);
    const deadline = Date.now() + (o.timeoutMs ?? 5 * 60_000);
    while (Date.now() < deadline) {
      const looks = await this.avatarLooks(groupId);
      const ready = looks.find((l) => l.preview_image_url && Number(l.image_width ?? 0) > 0 && Number(l.image_height ?? 0) > 0);
      if (ready) return ready;
      log.info("avatar look not ready yet; waiting");
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new HeyGenCliException({ message: `avatar group ${groupId} had no ready look within the timeout`, exitCode: 4 });
  }

  /** `heygen lipsync create` — drives an avatar look with our own narration audio. `--wait` blocks until the render finishes. */
  async lipsyncCreate(o: { avatarId: string; audioAssetId?: string; audioUrl?: string; wait?: boolean; onLine?: (l: string) => void }): Promise<Record<string, unknown>> {
    if (Boolean(o.audioAssetId) === Boolean(o.audioUrl)) throw new HeyGenCliException({ message: "exactly one of audioAssetId or audioUrl is required", exitCode: 2 });
    const args = ["lipsync", "create", FLAGS.lipsyncAvatar, o.avatarId];
    if (o.audioAssetId) args.push(FLAGS.lipsyncAudioAsset, o.audioAssetId);
    if (o.audioUrl) args.push(FLAGS.lipsyncAudioUrl, o.audioUrl);
    if (o.wait !== false) args.push("--wait");
    return this.json(args, { onLine: o.onLine });
  }

  async lipsyncGet(id: string): Promise<Record<string, unknown>> {
    return this.json(["lipsync", "get", id]);
  }

  async videoGet(id: string): Promise<Record<string, unknown>> {
    return this.json(["video", "get", id]);
  }

  /** `heygen video download <id> --output <file>`. */
  async videoDownload(id: string, outFile: string): Promise<string> {
    ensureDir(path.dirname(outFile));
    await this.json(["video", "download", id, FLAGS.videoDownloadOut, outFile]);
    if (!fs.existsSync(outFile)) throw new HeyGenCliException({ message: `heygen video download reported success but ${outFile} does not exist`, exitCode: 1 });
    return outFile;
  }
}

/** Commands the probe reports help for, so flag drift is a config change not a code change. */
export const PROBE_COMMANDS: string[][] = [
  ["voice", "list"],
  ["voice", "speech"],
  ["asset", "create"],
  ["avatar", "list"],
  ["avatar", "looks"],
  ["lipsync", "create"],
  ["video", "download"],
  ["user", "me"],
];
