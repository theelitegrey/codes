import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "../../core/env.js";
import { log } from "../../core/log.js";

/**
 * Thin wrapper over the Anthropic SDK used by every agent. Agents only use
 * `structured()` (schema-validated JSON via structured outputs) and
 * `research()` (server-side web search followed by structured extraction).
 */
export interface LLMOptions {
  model?: string;
  client?: Anthropic;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export class LLM {
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: NonNullable<LLMOptions["effort"]>;

  constructor(opts: LLMOptions = {}) {
    this.model = opts.model ?? env("SHORTS_LLM_MODEL", "claude-opus-5")!;
    this.client = opts.client ?? new Anthropic();
    this.effort = opts.effort ?? "high";
  }

  /** Ask for JSON matching `schema`. Refusal fallbacks are enabled server-side by default. */
  async structured<S extends z.ZodType>(schema: S, system: string, user: string, opts: { effort?: LLMOptions["effort"]; maxTokens?: number } = {}): Promise<z.infer<S>> {
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: opts.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { effort: opts.effort ?? this.effort, format: betaZodOutputFormat(schema) },
    });
    if (response.stop_reason === "refusal") {
      throw new Error(`Model declined the request (${response.stop_details?.type === "refusal" ? response.stop_details.category ?? "unspecified" : "refusal"})`);
    }
    if (response.stop_reason === "max_tokens") throw new Error("Model output truncated (max_tokens); retry with a higher limit");
    if (!response.parsed_output) throw new Error("Structured output could not be parsed");
    return response.parsed_output as z.infer<S>;
  }

  /**
   * Research with the server-side web search tool, then return the model's
   * written findings (with citations inlined as URLs). `pause_turn` is
   * handled by continuing the same conversation.
   */
  async research(system: string, user: string, opts: { maxSearches?: number } = {}): Promise<string> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: user }];
    for (let turn = 0; turn < 6; turn++) {
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches ?? 8 }],
        output_config: { effort: this.effort },
      });
      if (response.stop_reason === "refusal") throw new Error("Model declined the research request");
      messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason === "pause_turn") {
        log.info("web search paused; continuing");
        continue;
      }
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => {
          const cites = (b.citations ?? [])
            .map((c) => ("url" in c ? c.url : undefined))
            .filter((u): u is string => Boolean(u));
          return cites.length ? `${b.text} [${[...new Set(cites)].join(", ")}]` : b.text;
        })
        .join("\n");
      return text;
    }
    throw new Error("Research did not finish within the turn limit");
  }
}
