"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AVATAR_SVG } from "./avatar";

type CallState = "idle" | "connecting" | "listening" | "thinking" | "speaking";
type Msg = { role: string; content: string };
type Item = { id: number; kind: "u" | "p" | "sys"; text: string };

const HINT: Record<CallState, string> = {
  idle: "Start a call to say hello.",
  connecting: "Setting up a secure voice session. Allow the microphone when asked.",
  listening: "Go ahead, I\u2019m listening.",
  thinking: "One moment\u2026",
  speaking: "",
};
const SEG: [string, string][] = [
  ["idle", "Idle"],
  ["connecting", "Connecting"],
  ["listening", "Listening"],
  ["speaking", "Speaking"],
];
const CHIPS = [
  "What are you building right now?",
  "How do your AI agents work?",
  "Pitch me a micro-SaaS idea",
];
const EVENTS = {
  SESSION_READY: "SESSION_READY",
  MESSAGE_HISTORY_UPDATED: "MESSAGE_HISTORY_UPDATED",
  MESSAGE_STREAM_EVENT_RECEIVED: "MESSAGE_STREAM_EVENT_RECEIVED",
  CONNECTION_CLOSED: "CONNECTION_CLOSED",
};

const isLive = (s: CallState) => s === "listening" || s === "thinking" || s === "speaking";
const fmt = (n: number) =>
  String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");

export default function PersonaChat() {
  const clientRef = useRef<any>(null);
  const tokenRef = useRef(0);
  const idRef = useRef(0);
  const speakTimer = useRef<ReturnType<typeof setTimeout>>();
  const streamRef = useRef("");
  const historyRef = useRef<Msg[]>([]);
  const mutedRef = useRef(false);
  const stickRef = useRef(true);
  const threadRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [state, setState] = useState<CallState>("idle");
  const [caption, setCaption] = useState(HINT.idle);
  const [muted, setMuted] = useState(false);
  const [secs, setSecs] = useState(0);
  const [videoOn, setVideoOn] = useState(false);
  const [past, setPast] = useState<Item[]>([]);
  const [history, setHistory] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [canChat, setCanChat] = useState(true);
  const [bars, setBars] = useState<{ delay: string; t: string }[]>([]);

  const live = isLive(state);

  // Random waveform timings, generated on the client only to avoid hydration mismatch
  useEffect(() => {
    setBars(
      Array.from({ length: 30 }, () => ({
        delay: (-Math.random() * 1.4).toFixed(2) + "s",
        t: (0.8 + Math.random() * 0.8).toFixed(2) + "s",
      }))
    );
  }, []);

  useEffect(() => {
    document.documentElement.dataset.call = state;
  }, [state]);
  useEffect(() => {
    document.documentElement.dataset.chat = String(chatOpen);
  }, [chatOpen]);

  useEffect(() => {
    if (state === "connecting") setSecs(0);
  }, [state]);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [live]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  useLayoutEffect(() => {
    const el = threadRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [past, history, streaming, state, notice]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [draft]);

  const go = useCallback((s: CallState) => {
    setState(s);
    if (s !== "speaking" && s !== "thinking") {
      setCaption(s === "listening" && mutedRef.current ? "Microphone muted." : HINT[s]);
    }
  }, []);

  const teardown = useCallback(() => {
    const c = clientRef.current;
    clientRef.current = null;
    tokenRef.current++;
    clearTimeout(speakTimer.current);
    try {
      c?.stopStreaming();
    } catch {}
    if (videoRef.current) videoRef.current.srcObject = null;
    streamRef.current = "";
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const end = useCallback(() => {
    const wasLive = clientRef.current !== null;
    teardown();
    setVideoOn(false);
    setStreaming("");
    if (wasLive) {
      const done: Item[] = historyRef.current.map((m) => ({
        id: ++idRef.current,
        kind: m.role === "user" ? "u" : "p",
        text: m.content,
      }));
      done.push({ id: ++idRef.current, kind: "sys", text: "Call ended. Your transcript is kept here." });
      setPast((p) => [...p, ...done]);
    }
    historyRef.current = [];
    setHistory([]);
    go("idle");
  }, [teardown, go]);

  const playVideo = useCallback(() => {
    const v = videoRef.current;
    const pr = v?.play();
    pr?.catch(() => {
      if (!v) return;
      v.muted = true;
      v.play().catch(() => {});
      setNotice("Your browser blocked sound. Tap the avatar to turn it on.");
    });
  }, []);

  const fail = useCallback(
    (e: any) => {
      console.error(e);
      const msg =
        e?.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in your browser settings and try again."
          : e?.message === "Failed to fetch"
          ? "Could not reach the session service. Check your connection and try again."
          : e?.message || "Something went wrong starting the call.";
      teardown();
      setVideoOn(false);
      go("idle");
      setCaption(msg);
      setNotice(msg);
    },
    [teardown, go]
  );

  async function start() {
    const t = ++tokenRef.current;
    go("connecting");
    try {
      const res = await fetch("/api/session-token", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.sessionToken)
        throw new Error(body.error ?? `Could not start a session (${res.status})`);
      if (t !== tokenRef.current) return;

      const sdk: any = await import("@anam-ai/js-sdk");
      if (t !== tokenRef.current) return;
      const E = sdk.AnamEvent ?? EVENTS;

      const c = sdk.createClient(body.sessionToken);
      clientRef.current = c;
      if (videoRef.current) videoRef.current.muted = false;
      setCanChat(typeof c.sendUserMessage === "function");

      c.addListener(E.SESSION_READY, () => {
        setVideoOn(true);
        go("listening");
        playVideo();
      });
      c.addListener(E.MESSAGE_HISTORY_UPDATED, (ms: Msg[]) => {
        historyRef.current = [...ms];
        setHistory([...ms]);
        streamRef.current = "";
        setStreaming("");
      });
      c.addListener(E.MESSAGE_STREAM_EVENT_RECEIVED, (ev: Msg) => {
        if (!clientRef.current) return;
        if (ev.role === "persona") {
          setState("speaking");
          streamRef.current += ev.content;
          setStreaming(streamRef.current);
          setCaption(streamRef.current.split(" ").slice(-10).join(" "));
          clearTimeout(speakTimer.current);
          speakTimer.current = setTimeout(() => {
            if (clientRef.current) go("listening");
          }, 1600);
        } else if (ev.role === "user") {
          streamRef.current = "";
          setStreaming("");
          setState("thinking");
          setCaption("You: " + ev.content);
        }
      });
      c.addListener(E.CONNECTION_CLOSED, () => {
        if (clientRef.current) end();
      });

      await c.streamToVideoElement("persona-video");
      if (t === tokenRef.current && clientRef.current === c) {
        setVideoOn(true);
        setState((s) => (s === "connecting" ? "listening" : s));
        setCaption((cap) => (cap === HINT.connecting ? HINT.listening : cap));
        playVideo();
      }
    } catch (e) {
      if (t === tokenRef.current) fail(e);
    }
  }

  async function sendMessage(text: string) {
    const c = clientRef.current;
    if (!c) return;
    try {
      typeof c.sendUserMessage === "function" ? await c.sendUserMessage(text) : await c.talk(text);
    } catch {
      setNotice("Message failed to send. Try again.");
    }
  }

  function submit() {
    const v = draft.trim();
    if (!v || !live) return;
    setDraft("");
    sendMessage(v);
  }

  function toggleMute() {
    const m = !muted;
    setMuted(m);
    mutedRef.current = m;
    try {
      m ? clientRef.current?.muteInputAudio() : clientRef.current?.unmuteInputAudio();
    } catch {}
    if (state === "listening") setCaption(m ? "Microphone muted." : HINT.listening);
  }

  async function copyTranscript() {
    const lines = [
      ...past.filter((i) => i.kind !== "sys").map((i) => [i.kind === "u", i.text] as const),
      ...history.map((m) => [m.role === "user", m.content] as const),
    ].map(([u, t]) => (u ? "You: " : "Muhaimin: ") + t);
    if (!lines.length) return;
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setNotice("Transcript copied.");
    } catch {
      setNotice("Copy blocked by the browser. Select the text instead.");
    }
  }

  function toggleTheme() {
    const root = document.documentElement;
    const dark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme:dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
  }

  const pressed = state === "thinking" ? "listening" : state;
  const inCall = live || state === "connecting";
  const empty = past.length === 0 && history.length === 0 && !streaming;
  const chipsOn = live && state !== "thinking" && state !== "speaking";

  return (
    <>
      <div className="aurora" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="wrap">
        <header className="top">
          <div className="brand">
            <span className="dot" />
            <div>
              <b>Muhaimin</b>
              <small>AI persona</small>
            </div>
          </div>
          <div className="right">
            <div className="seg" role="status" aria-label="Call state">
              {SEG.map(([s, label]) => (
                <button key={s} type="button" tabIndex={-1} aria-pressed={s === pressed}>
                  {label}
                </button>
              ))}
            </div>
            <button className="icon" onClick={toggleTheme} aria-label="Switch light or dark theme">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            </button>
          </div>
        </header>

        <section className="intro">
          <h1>Talk to Muhaimin</h1>
          <p>Ask about his AI agents and micro-SaaS builds. Speak, or type if you&rsquo;d rather.</p>
        </section>

        <main className="app">
          <section
            className="stage"
            data-state={state}
            data-muted={muted}
            data-live={videoOn}
            aria-label="Voice call"
          >
            <div className="orbwrap">
              <div className="orb" aria-hidden="true">
                <i className="ring" />
                <i className="ring" />
                <i className="ring" />
                <div className="core" />
                <div className="gloss" />
                <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: AVATAR_SVG }} />
                <video
                  id="persona-video"
                  ref={videoRef}
                  className="pvideo"
                  autoPlay
                  playsInline
                  onPlaying={() => clientRef.current && setVideoOn(true)}
                  onLoadedData={() => clientRef.current && setVideoOn(true)}
                  onClick={() => {
                    const v = videoRef.current;
                    if (v) {
                      v.muted = false;
                      v.play().catch(() => {});
                    }
                  }}
                />
                <div className="spin" />
              </div>
              <div className="time timechip" role="timer" aria-label="Call duration">
                {fmt(secs)}
              </div>
              <div className="wave" aria-hidden="true">
                {bars.map((b, i) => (
                  <span key={i} style={{ animationDelay: b.delay, ["--t" as any]: b.t }} />
                ))}
              </div>
              <p className="caption">{caption}</p>
            </div>

            <div className="dock">
              <button
                className="round"
                onClick={toggleMute}
                aria-pressed={muted}
                aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              >
                <svg viewBox="0 0 24 24">
                  <rect x="9" y="3" width="6" height="12" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  <path className="slash" d="M4 4l16 16" />
                </svg>
              </button>
              <button className="call" onClick={() => (state === "idle" ? start() : end())} data-live={inCall}>
                <svg viewBox="0 0 24 24">
                  <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
                </svg>
                <span className="lbl">{inCall ? "End call" : "Start call"}</span>
              </button>
              <button
                className="round chatbtn"
                onClick={() => setChatOpen((o) => !o)}
                aria-expanded={chatOpen}
                aria-controls="chatPanel"
                aria-label={chatOpen ? "Hide conversation" : "Show conversation"}
              >
                <svg viewBox="0 0 24 24">
                  <path d="M4 5h16v11H9l-5 4z" />
                </svg>
              </button>
            </div>
          </section>

          <section className="chat" id="chatPanel" data-open={chatOpen} aria-label="Conversation">
            <div className="chead">
              <h2>Conversation</h2>
              <button onClick={copyTranscript} aria-label="Copy transcript">
                <svg viewBox="0 0 24 24">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15V6a2 2 0 0 1 2-2h9" />
                </svg>
              </button>
            </div>
            <div
              className="thread"
              ref={threadRef}
              role="log"
              aria-live="polite"
              onScroll={(e) => {
                const el = e.currentTarget;
                stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
              }}
            >
              {empty && (
                <div className="empty">
                  <p>Your conversation shows up here, and stays after the call ends.</p>
                  <div className="chips">
                    {CHIPS.map((c) => (
                      <button key={c} className="chip" disabled={!chipsOn} onClick={() => sendMessage(c)}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {past.map((i) => (
                <div key={i.id} className={i.kind === "sys" ? "sys" : `m ${i.kind}`}>
                  {i.text}
                </div>
              ))}
              {history.map((m, i) => (
                <div key={`h${i}`} className={`m ${m.role === "user" ? "u" : "p"}`}>
                  {m.content}
                </div>
              ))}
              {streaming && <div className="m p">{streaming}</div>}
              {state === "thinking" && (
                <div className="m p typing">
                  <i />
                  <i />
                  <i />
                </div>
              )}
              {notice && <div className="sys">{notice}</div>}
            </div>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <textarea
                ref={inputRef}
                rows={1}
                value={draft}
                disabled={!live}
                aria-label="Message"
                placeholder={
                  live
                    ? canChat
                      ? "Ask Muhaimin anything"
                      : "Type something for Muhaimin to say"
                    : "Start the call to chat"
                }
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <button className="send" aria-label="Send message" disabled={!live || !draft.trim()}>
                <svg viewBox="0 0 24 24">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </form>
          </section>
        </main>
      </div>
    </>
  );
}
