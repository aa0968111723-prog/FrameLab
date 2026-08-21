export type VlmResult = {
  ok: true;
  text: string;
  model: string;
  provider: "xai";
} | {
  ok: false;
  code: "MODEL_NOT_AVAILABLE" | "JOB_FAILED";
  error: string;
};

export async function analyzeFrameWithGrok(input: {
  imageBase64: string;
  prompt: string;
}): Promise<VlmResult> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      code: "MODEL_NOT_AVAILABLE",
      error: "XAI_API_KEY is not available in this environment.",
    };
  }
  const prompt =
    input.prompt.trim() ||
    [
      "You are an animation supervisor looking at a single frame from a frame-by-frame sequence.",
      "Describe: subject, pose, silhouette, contact with ground or objects, volume (squash/stretch), and anything that would break continuity with neighboring frames.",
      "Be concrete. Do not invent production credits. If you cannot see something, say so.",
    ].join(" ");

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-4.5",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${input.imageBase64}`,
              },
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      code: "JOB_FAILED",
      error: `xAI API error ${res.status}: ${body.slice(0, 280)}`,
    };
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  return { ok: true, text, model: "grok-4.5", provider: "xai" };
}
