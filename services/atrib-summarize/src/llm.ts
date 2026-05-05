// SPDX-License-Identifier: Apache-2.0

/**
 * OpenAI-compatible chat completion client.
 *
 * Defaults to the env-configured endpoint and model. Designed for use
 * with NVIDIA NIM, Together, OpenRouter, or any OpenAI-compatible
 * provider. The summarize tool is the only consumer.
 */

export interface LlmConfig {
  baseUrl: string
  model: string
  apiKey: string
  maxTokens: number
  temperature: number
  timeoutMs: number
}

export interface LlmResult {
  content: string
  model: string
}

/**
 * Resolve LLM config from env with documented defaults. Caller-supplied
 * model override (from the MCP tool input) wins over env.
 */
export function resolveLlmConfig(modelOverride?: string): LlmConfig | null {
  const apiKey =
    process.env['ATRIB_SUMMARIZE_API_KEY'] ??
    process.env['NVIDIA_API_KEY'] ??
    process.env['NVIDIA_NIM_API_KEY'] ??
    ''
  if (!apiKey) return null
  return {
    baseUrl:
      process.env['ATRIB_SUMMARIZE_BASE_URL'] ?? 'https://integrate.api.nvidia.com/v1',
    model: modelOverride ?? process.env['ATRIB_SUMMARIZE_MODEL'] ?? 'qwen/qwen3.5-397b-a17b',
    apiKey,
    maxTokens: Number(process.env['ATRIB_SUMMARIZE_MAX_TOKENS'] ?? 4000),
    temperature: Number(process.env['ATRIB_SUMMARIZE_TEMPERATURE'] ?? 0.3),
    timeoutMs: Number(process.env['ATRIB_SUMMARIZE_TIMEOUT_MS'] ?? 120000),
  }
}

/**
 * POST one chat completion. Throws on HTTP error so the caller can
 * surface it via warnings; never silently returns empty content.
 */
export async function callLlm(
  cfg: LlmConfig,
  systemMsg: string,
  userMsg: string,
): Promise<LlmResult> {
  const url = cfg.baseUrl.replace(/\/$/, '') + '/chat/completions'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: userMsg },
        ],
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '<no body>')
      throw new Error(`LLM POST ${res.status}: ${text.slice(0, 500)}`)
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      model?: string
    }
    const content = json.choices?.[0]?.message?.content ?? ''
    if (!content) throw new Error('LLM response had empty content')
    return { content, model: json.model ?? cfg.model }
  } finally {
    clearTimeout(timer)
  }
}
