const SAMPLE_RATE = 8000;
const FRAME_SIZE = 320;

// Capture speech at 8 kHz and encode each sample as an 8-bit companded value.
const processor = `
class TabletopSpeech extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Uint8Array(320);
    this.index = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.enabled = false;
    this.port.onmessage = ({ data }) => {
      this.enabled = data;
      this.index = this.phase = this.sum = this.count = 0;
    };
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel || !this.enabled) return true;
    for (const sample of channel) {
      this.sum += sample;
      this.count++;
      this.phase += 8000;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      const value = Math.max(-1, Math.min(1, this.sum / this.count));
      const compressed = Math.sign(value) * Math.log1p(255 * Math.abs(value)) / Math.log(256);
      this.frame[this.index++] = Math.round((compressed + 1) * 127.5);
      this.sum = this.count = 0;
      if (this.index === this.frame.length) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Uint8Array(320);
        this.index = 0;
      }
    }
    return true;
  }
}
registerProcessor('tabletop-speech', TabletopSpeech);
`;

export function createVoiceRelay(send) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  const context = new AudioContext();
  const streams = new Map();
  let capture;
  let source;
  let mutedOutput;
  let enabled = false;
  let closed = false;

  async function attach(stream) {
    if (!context.audioWorklet) return;
    const url = URL.createObjectURL(
      new Blob([processor], { type: 'text/javascript' }),
    );
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (closed) return;
    source = context.createMediaStreamSource(stream);
    capture = new AudioWorkletNode(context, 'tabletop-speech');
    mutedOutput = context.createGain();
    mutedOutput.gain.value = 0;
    capture.port.onmessage = ({ data }) => {
      if (enabled) send(data);
    };
    capture.port.postMessage(enabled);
    source.connect(capture).connect(mutedOutput).connect(context.destination);
  }

  function play(id, frame) {
    if (
      context.state !== 'running' ||
      !(frame instanceof ArrayBuffer) ||
      frame.byteLength !== FRAME_SIZE
    )
      return;
    const now = context.currentTime;
    const previous = streams.get(id) ?? 0;
    if (previous > now + 0.4) return;
    const buffer = context.createBuffer(1, FRAME_SIZE, SAMPLE_RATE);
    const output = buffer.getChannelData(0);
    new Uint8Array(frame).forEach((value, index) => {
      const sample = value / 127.5 - 1;
      output[index] =
        (Math.sign(sample) * Math.expm1(Math.abs(sample) * Math.log(256))) /
        255;
    });
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(context.destination);
    const start = Math.max(previous, now + 0.08);
    node.start(start);
    streams.set(id, start + buffer.duration);
  }

  return {
    attach,
    play,
    resume: () => context.resume(),
    remove: (id) => streams.delete(id),
    enable(value) {
      enabled = value;
      capture?.port.postMessage(value);
    },
    close() {
      closed = true;
      if (capture) capture.port.onmessage = null;
      source?.disconnect();
      capture?.disconnect();
      mutedOutput?.disconnect();
      streams.clear();
      void context.close().catch(() => {});
    },
  };
}
