# Talk to Muhaimin: Anam + Next.js

Voice and text chat with an Anam AI persona, using the mockup UI (aurora background, animated orb/avatar, glass dock, conversation panel, light/dark theme).

## Run locally
```bash
npm install
cp .env.example .env.local   # add your ANAM_API_KEY
npm run dev                  # http://localhost:3000
```

## Deploy to Vercel
1. Push to Git and import at vercel.com/new (or run `npx vercel`).
2. Add `ANAM_API_KEY` under Project Settings, Environment Variables.
3. Deploy. HTTPS is automatic, which browsers require for microphone access.

## Notes
- The API key stays server-side in `app/api/session-token/route.ts`, which also holds the persona config (avatar, voice, LLM, system prompt) and a basic in-memory rate limit.
- The mockup's demo mode and in-page API key dialog were removed; the app always talks to the live persona through the server route.
- UI lives in `components/PersonaChat.tsx`; styles are the mockup's CSS in `app/globals.css`.
