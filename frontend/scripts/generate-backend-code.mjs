import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(here, '..');
const backendRoot = path.join(frontendRoot, '..', 'backend');
const outFile = path.join(frontendRoot, 'src', 'data', 'backendCode.ts');

const files = [
  {name: 'setup_server.sh', rel: 'setup_server.sh', language: 'bash', category: 'script',
   path: '/app/agent/setup_server.sh',
   description: 'Idempotent Ubuntu 24.04 installer for x86_64 and aarch64: swapfile, IceWM, venv, Playwright, systemd, secrets. Tuned for 4 GB RAM VPS.'},
  {name: 'main.py', rel: 'main.py', language: 'python', category: 'python',
   path: '/app/agent/main.py',
   description: 'FastAPI + WebSocket: jobs/channels API, vision /api/task, health, budget. Messaging removed.'},
  {name: 'agent_core.py', rel: 'agent_core.py', language: 'python', category: 'python',
   path: '/app/agent/agent_core.py',
   description: 'Playwright persistent browser and vision-loop tasks (YouTube etc.).'},
  {name: 'vision_loop.py', rel: 'vision_loop.py', language: 'python', category: 'python',
   path: '/app/agent/vision_loop.py',
   description: 'Driver-agnostic vision loop: screenshot → DeepSeek Flash (Gemini fallback) → JSON actions. Browser or Windows desktop.'},
  {name: 'video_pipeline.py', rel: 'video_pipeline.py', language: 'python', category: 'python',
   path: '/app/agent/video_pipeline.py',
   description: 'FFmpeg + free gTTS video pipeline; optional Gemini TTS; assemble_video fallback editor.'},
  {name: 'pipeline.py', rel: 'pipeline.py', language: 'python', category: 'python',
   path: '/app/agent/pipeline.py',
   description: 'Phase 1 job orchestrator: story (ChatGPT/DeepSeek) → voiceover → FFmpeg/CapCut edit.'},
  {name: 'requirements.txt', rel: 'requirements.txt', language: 'plaintext', category: 'config',
   path: '/app/agent/requirements.txt',
   description: 'Pinned Python dependencies.'},
  {name: '.env.example', rel: '.env.example', language: 'plaintext', category: 'config',
   path: '/app/agent/.env.example',
   description: 'Environment template. Real secrets stay on the VM in /app/agent/.env.'},
];

function tsString(s) {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

const items = files.map((f) => {
  const abs = path.join(backendRoot, f.rel);
  if (!fs.existsSync(abs)) throw new Error(`Missing backend file: ${abs}`);
  const content = fs.readFileSync(abs, 'utf8');
  return `  {
    name: ${JSON.stringify(f.name)},
    path: ${JSON.stringify(f.path)},
    description: ${JSON.stringify(f.description)},
    language: ${JSON.stringify(f.language)},
    category: ${JSON.stringify(f.category)},
    content: \`${tsString(content)}\`,
  }`;
});

const out = `export interface BackendFile {
  name: string;
  path: string;
  description: string;
  language: string;
  category: 'script' | 'python' | 'config' | 'compose';
  content: string;
}

/** Generated at build time from ../backend. Do not edit by hand. */
export const BACKEND_FILES: BackendFile[] = [
${items.join(',\n')}
];
`;

fs.mkdirSync(path.dirname(outFile), {recursive: true});
fs.writeFileSync(outFile, out);
console.log(`wrote ${outFile} (${files.length} files)`);
