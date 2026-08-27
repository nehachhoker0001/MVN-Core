Google Cloud Speech wrapper

This wrapper uses the `@google-cloud/speech` Node client to transcribe a local audio file and print the transcript to stdout.

Prerequisites

- A Google Cloud project with the Speech-to-Text API enabled.
- A service account key JSON file. Set the path via:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
```

Usage

1. Install dependencies:

```bash
npm install
```

2. Run the wrapper:

```bash
node tools/transcribe_gcloud.js /path/to/file.wav en-US
```

Notes

- The script assumes 16 kHz mono LINEAR16 PCM audio (the server-side adapter already normalizes recordings to this format). If your audio is different, adjust the `config` in the script.
- For long audio (>1 minute), consider using `client.longRunningRecognize()` instead of `recognize()`.
 - The provided wrapper now auto-uses `longRunningRecognize()` for large files (>= 5 MB).
- You can wire this as the server `TRANSCRIBE_CMD`:

```bash
export TRANSCRIBE_CMD="node tools/transcribe_gcloud.js"
export TRANSCRIBE_CMD_LANG_FORMAT="{lang}"
export TRANSCRIBE_FALLBACK_LANGS="en,hi,pt,ru,zh"
npm start
```
