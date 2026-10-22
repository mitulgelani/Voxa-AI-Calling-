import http from 'node:http';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { log } from './log.js';
import { verifyCall } from './token.js';
import { db } from './db.js';
import { CallSession, live } from './session.js';
import { ringing, dialOnce, completeFinished } from './dialler.js';
import { finishUnanswered } from './post.js';
import { deliverWebhooks, purgeRecordings, verifyNumbers } from './jobs.js';
import { plivoAnswerXml, plivoLink, plivoOutcome } from './carriers/plivo.js';
import { telnyxLink, telnyxOutcome, verifyTelnyx } from './carriers/telnyx.js';

const MAX_BODY = 64 * 1024;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const send = (res: http.ServerResponse, status: number, body = '', type = 'text/plain') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', config.publicUrl);
  try {
    if (url.pathname === '/health') return send(res, 200, JSON.stringify({ ok: true, live: live.size, ringing: ringing.size }), 'application/json');
    if (req.method !== 'POST') return send(res, 405);
    const callId = verifyCall(url.searchParams.get('c'));
    if (!callId) return send(res, 403);
    const raw = await readBody(req);

    if (url.pathname === '/plivo/answer') return send(res, 200, plivoAnswerXml(url.searchParams.get('c')!), 'application/xml');
    if (url.pathname === '/plivo/machine') {
      const form = new URLSearchParams(raw);
      if ((form.get('Machine') ?? '').toLowerCase() === 'true') {
        const s = live.get(callId);
        if (s) await s.end('agent');
        await finishUnanswered(callId, 'voicemail');
      }
      return send(res, 200);
    }
    if (url.pathname === '/plivo/hangup') {
      ringing.delete(callId);
      const outcome = plivoOutcome(new URLSearchParams(raw));
      if (!live.has(callId) && outcome) await finishUnanswered(callId, outcome);
      return send(res, 200);
    }
    if (url.pathname === '/telnyx/webhook') {
      if (!verifyTelnyx(raw, req.headers['telnyx-signature-ed25519'] as string, req.headers['telnyx-timestamp'] as string)) return send(res, 403);
      const evt = JSON.parse(raw) as { data?: { event_type?: string; payload?: { hangup_cause?: string; result?: string } } };
      const type = evt.data?.event_type;
      if (type === 'call.machine.detection.ended' && evt.data?.payload?.result === 'machine') {
        const s = live.get(callId);
        if (s) await s.end('agent'); else await finishUnanswered(callId, 'voicemail');
      }
      if (type === 'call.hangup') {
        ringing.delete(callId);
        const outcome = telnyxOutcome(evt.data?.payload?.hangup_cause ?? '');
        if (!live.has(callId) && outcome) await finishUnanswered(callId, outcome);
      }
      return send(res, 200);
    }
    return send(res, 404);
  } catch (e) {
    log('error', 'http error', { path: url.pathname, err: String(e) });
    return send(res, 500);
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', config.publicUrl);
  const carrier = url.pathname === '/media/plivo' ? 'plivo' : url.pathname === '/media/telnyx' ? 'telnyx' : null;
  const callId = verifyCall(url.searchParams.get('c'));
  if (!carrier || !callId || live.has(callId)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const link = carrier === 'plivo' ? plivoLink() : telnyxLink();
    const session = new CallSession(callId, ws, link, carrier);
    live.set(callId, session);
    ringing.delete(callId);
    let started = false;
    ws.on('message', (data) => {
      try {
        const m = link.parse(data.toString());
        if (m.kind === 'start' && !started) {
          started = true;
          session.start(m.carrierCallId).catch(async (e) => {
            log('error', 'session start failed', { call: callId, err: String(e) });
            ws.close();
          });
        } else if (m.kind === 'media') session.onAudio(m.audio);
        else if (m.kind === 'stop') ws.close();
      } catch (e) { log('warn', 'bad media frame', { call: callId, err: String(e) }); }
    });
    ws.on('close', () => void session.finish());
    ws.on('error', () => void session.finish());
  });
});

function every(ms: number, name: string, fn: () => Promise<unknown>) {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try { await fn(); } catch (e) { log('error', `${name} failed`, { err: String(e) }); } finally { running = false; }
  }, ms).unref();
}

let draining = false;
every(2000, 'dialler', () => (draining ? Promise.resolve() : dialOnce()));
every(60_000, 'complete', completeFinished);
every(5000, 'webhooks', deliverWebhooks);
every(10 * 60_000, 'verify', verifyNumbers);
every(6 * 3600_000, 'purge', purgeRecordings);

server.listen(config.port, () => log('info', 'voice gateway listening', { port: config.port, tts: config.ttsProvider }));

// Deploys: stop dialling, let live calls finish (up to the max call length), then exit.
process.on('SIGTERM', () => {
  draining = true;
  log('info', 'draining', { live: live.size });
  const check = setInterval(() => { if (live.size === 0) { clearInterval(check); process.exit(0); } }, 1000);
  setTimeout(() => process.exit(0), (config.maxCallSeconds + 30) * 1000).unref();
  void db; // keep client referenced until exit
});
