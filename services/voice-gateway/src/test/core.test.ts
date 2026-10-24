import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PUBLIC_URL ??= 'https://gw.test';
process.env.SUPABASE_URL ??= 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test';
process.env.GATEWAY_SECRET ??= 'a'.repeat(64);

const { mulawToPcm, pcmToMulaw, resample, wav, parseWav, Tape } = await import('../audio.js');
const { signCall, verifyCall } = await import('../token.js');
const { TurnDetector } = await import('../turns.js');
const { OPT_OUT, speechChunks, systemPrompt } = await import('../brain.js');

test('µ-law round trip stays within quantisation error', () => {
  const pcm = Int16Array.from({ length: 800 }, (_, i) => Math.round(Math.sin(i / 5) * 12000));
  const back = mulawToPcm(pcmToMulaw(pcm));
  for (let i = 0; i < pcm.length; i++) assert.ok(Math.abs(back[i] - pcm[i]) <= Math.abs(pcm[i]) * 0.07 + 40, `sample ${i}`);
});

test('wav write then parse returns the same samples', () => {
  const pcm = Int16Array.from({ length: 160 }, (_, i) => i * 10 - 800);
  const { pcm: out, rate } = parseWav(wav(pcm, 8000));
  assert.equal(rate, 8000);
  assert.deepEqual(Array.from(out), Array.from(pcm));
  assert.equal(resample(pcm, 8000, 16000).length, 320);
});

test('call tokens verify, and reject tampering', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  const t = signCall(id, 60);
  assert.equal(verifyCall(t), id);
  assert.equal(verifyCall(t.replace(id, '11111111-2222-3333-4444-555555555556')), null);
  assert.equal(verifyCall(t.slice(0, -2) + 'xx'), null);
  assert.equal(verifyCall(signCall(id, -10)), null);
});

test('turn detector finds one utterance between silences', () => {
  const ends: [number, number][] = [];
  const d = new TurnDetector(() => undefined, (_p, s, e) => ends.push([s, e]));
  const frame = (loud: boolean) => Int16Array.from({ length: 160 }, (_, i) => (loud ? Math.round(Math.sin(i / 3) * 6000) : Math.round(Math.sin(i) * 30)));
  let t = 0;
  for (let i = 0; i < 50; i++, t += 20) d.push(frame(false), t, false);
  for (let i = 0; i < 40; i++, t += 20) d.push(frame(true), t, false);
  for (let i = 0; i < 50; i++, t += 20) d.push(frame(false), t, false);
  assert.equal(ends.length, 1);
  assert.ok(ends[0][0] >= 900 && ends[0][0] <= 1100, `start ${ends[0][0]}`);
  assert.ok(ends[0][1] >= 1700 && ends[0][1] <= 1900, `end ${ends[0][1]}`);
});

test('tape mixes on the timeline', () => {
  const tape = new Tape();
  tape.mix(1000, Int16Array.from([1000, 1000]));
  const { pcm } = parseWav(tape.toWav(2000));
  assert.equal(pcm.length, 16000);
  assert.equal(pcm[8000], 1000);
});

test('opt-out phrases in Hindi, Hinglish, Gujarati and English', () => {
  for (const s of ['please don\'t call me again', 'mujhe call mat karo', 'मुझे दोबारा फोन मत करना', 'મને ફોન ના કરશો', 'remove my number']) assert.ok(OPT_OUT.test(s), s);
  for (const s of ['call time pe aaya', 'I will call you back', 'हाँ ठीक है']) assert.ok(!OPT_OUT.test(s), s);
});

test('long replies split into speakable chunks without breaking numbers', () => {
  const text = 'It costs ₹4,999.50 a month. That includes setup! Do you want the 4.5 star plan? First, we visit. Then we install. Finally, we train your team.';
  const parts = speechChunks(text, 60);
  assert.ok(parts.length >= 3, `got ${parts.length}`);
  assert.equal(parts.join(' '), text);
  assert.ok(parts.every((p) => p.length <= 60 || !p.includes(' ')), 'chunks respect the size when sentences allow');
  assert.ok(parts.some((p) => p.includes('₹4,999.50')) && parts.some((p) => p.includes('4.5 star')), 'numbers stay whole');
  assert.deepEqual(speechChunks('हाँ जी। आपका ऑर्डर कल आएगा। ठीक है?', 12), ['हाँ जी।', 'आपका ऑर्डर कल आएगा।', 'ठीक है?']);
  assert.deepEqual(speechChunks('no punctuation at all'), ['no punctuation at all']);
});

test('call prompt: adaptive length, brief first, tags kept, opening not repeated', () => {
  const p = systemPrompt(
    { agentName: 'Riya', goal: 'Book a renewal call', persona: 'GOAL: renew\nFLOW: 1. confirm', opening: 'Hi', disclosure: 'AI', questions: [{ key: 'q1', type: 'rating', prompt: 'Rate us', required: true }], languages: ['hinglish', 'en-IN'] },
    'hinglish',
    { name: 'Mitul', attrs: { plan: 'Gold' } },
  );
  assert.match(p, /Your name is Riya\./);
  assert.ok(p.startsWith('# How you work'), 'the shared, cacheable part comes first');
  assert.doesNotMatch(p.slice(0, p.indexOf('# Your brief')), /Riya|Mitul|Gold/, 'nothing call-specific before the brief');
  assert.match(p, /5 to 10 short sentences/);
  assert.match(p, /about a minute of speech/);
  assert.doesNotMatch(p, /under 25 words/);
  assert.match(p, /\[OPTOUT\] \[END\]/);
  assert.match(p, /\[CALLBACK\] \[END\]/);
  assert.match(p, /already been said/);
  assert.match(p, /Rate us \(a number from 1 to 5\)/);
  assert.match(p, /Known details: plan: Gold/);
  assert.ok(p.indexOf('# Your brief') < p.indexOf('# Rules that override everything above'), 'rules come last');
});
