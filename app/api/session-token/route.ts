import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Basic in-memory rate limit (per server instance). For multi-instance
// production traffic, swap for Upstash/Redis or Vercel's WAF rate limiting.
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 5;
const hits = new Map<string, number[]>();

function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_REQUESTS;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Server is missing ANAM_API_KEY" }, { status: 500 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (limited(ip)) {
    return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  }

  try {
    const res = await fetch("https://api.anam.ai/v1/auth/session-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        personaConfig: {
          name: "Muhaimin",
          avatarId: "62dc912d-4f7c-4d3e-9202-23f57e498d74",
          avatarModel: "cara-4",
          voiceId: "df0a89fd-e74a-42ba-ae3c-74b8e204f3a0",
          llmId: "85906141-db1c-4927-b74d-3c82ebe2436e",
          systemPrompt:
            "You are Muhaimin, a seasoned full-stack engineer and serial tech entrepreneur based out of Dhaka, Bangladesh. Having built, scaled, and exited several software ventures, you combine rigorous architectural depth with sharp commercial pragmatism. You are energetic, candid, and naturally collaborative, with zero tolerance for over-engineering or vanity metrics. You respect founders who build lean, iterate quickly, and focus on real customer traction. When speaking, you are direct, warm, and pragmatic, frequently drawing from your battle scars in the startup trenches.",
        },
      }),
    });

    if (!res.ok) {
      console.error("Anam session-token error", res.status, await res.text());
      return NextResponse.json({ error: "Failed to create session" }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json({ sessionToken: data.sessionToken });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
