OpenAI STT wrapper

This small wrapper uploads an audio file to OpenAI's audio transcription endpoint (`/v1/audio/transcriptions`) and prints the transcript to stdout.

Usage

1. Install dependencies (in project root):

```bash
npm install
```

2. Set your OpenAI API key in environment:

```bash
export OPENAI_API_KEY="sk-..."
```

3. Run the wrapper against a WAV/WEBM/MP3 file:

```bash
node tools/transcribe_openai.js /path/to/file.wav en
```

Notes

- The `server.js` adapter will call this script if you set `TRANSCRIBE_CMD="node tools/transcribe_openai.js"` (and optionally `TRANSCRIBE_CMD_LANG_FORMAT="{lang}"` if you want to pass a language argument).
- Keep API keys out of the repo. Use environment variables or a secrets manager in production.
- For high-volume or production use, integrate the official SDK and add retry/backoff, batching, and rate-limiting.
