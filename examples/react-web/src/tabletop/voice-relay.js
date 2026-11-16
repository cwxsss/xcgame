const SAMPLE_RATE = 8000;
const FRAME_SIZE = 320;

function speechEncoder(inputRate, outputRate, frameSize, emit) {
  let frame = new Uint8Array(frameSize);
  let index = 0;
  let phase = 0;
  let sum = 0;
  let count = 0;
  return {
    reset() {
      index = phase = sum = count = 0;
    },
    push(channel) {
      for (const sample of channel) {
        sum += sample;
        count++;
        phase += outputRate;
        if (phase < inputRate) continue;
        phase -= inputRate;
        const value = Math.max(-1, Math.min(1, sum / count));
        const compressed =
          (Math.sign(value) * Math.log1p(255 * Math.abs(value))) /
          Math.log(256);
        frame[index++] = Math.round((compressed + 1) * 127.5);
        sum = count = 0;
        if (index === frameSize) {
          emit(frame.buffer);
          frame = new Uint8Array(frameSize);
          index = 0;
        }
      }
    },
  };
}

// Keep the relay's packet format compatible with clients already in a room.
const processor = `
const createEncoder = ${speechEncoder.toString()};
class TabletopSpeech extends AudioWorkletProcessor {
  constructor() {
    super();
    this.encoder = createEncoder(sampleRate, ${SAMPLE_RATE}, ${FRAME_SIZE},
      (frame) => this.port.postMessage(frame, [frame]));
    this.enabled = false;
    this.port.onmessage = ({ data }) => {
      this.enabled = data;
      this.encoder.reset();
    };
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel && this.enabled) this.encoder.push(channel);
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
  let highPass;
  let presence;
  let compressor;
  let mutedOutput;
  let legacyEncoder;
  let enabled = false;
  let closed = false;

  async function attach(stream) {
    if (context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      const url = URL.createObjectURL(
        new Blob([processor], { type: 'text/javascript' }),
      );
      try {
        await context.audioWorklet.addModule(url);
        if (closed) return;
        capture = new AudioWorkletNode(context, 'tabletop-speech');
        capture.port.onmessage = ({ data }) => {
          if (enabled) send(data);
        };
        capture.port.postMessage(enabled);
      } catch {
        // Some mobile WebViews reject worklet modules created from a Blob.
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    if (closed) return;
    if (!capture && typeof context.createScriptProcessor === 'function') {
      legacyEncoder = speechEncoder(
        context.sampleRate,
        SAMPLE_RATE,
        FRAME_SIZE,
        send,
      );
      capture = context.createScriptProcessor(1024, 1, 1);
      capture.onaudioprocess = ({ inputBuffer }) => {
        if (enabled) legacyEncoder.push(inputBuffer.getChannelData(0));
      };
    }
    if (!capture) return;

    source = context.createMediaStreamSource(stream);
    highPass = context.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 95;
    presence = context.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 1800;
    presence.Q.value = 0.85;
    presence.gain.value = 2.5;
    compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -22;
    compressor.ratio.value = 2.5;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.16;
    mutedOutput = context.createGain();
    mutedOutput.gain.value = 0;
    source
      .connect(highPass)
      .connect(presence)
      .connect(compressor)
      .connect(capture)
      .connect(mutedOutput)
      .connect(context.destination);
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
      capture?.port?.postMessage(value);
      legacyEncoder?.reset();
    },
    close() {
      closed = true;
      if (capture?.port) capture.port.onmessage = null;
      if (legacyEncoder) capture.onaudioprocess = null;
      source?.disconnect();
      highPass?.disconnect();
      presence?.disconnect();
      compressor?.disconnect();
      capture?.disconnect();
      mutedOutput?.disconnect();
      streams.clear();
      void context.close().catch(() => {});
    },
  };
}
