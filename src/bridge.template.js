// API exposta ao wasm-bindgen. Este arquivo é concatenado após o core vendored
// por tools/build-bridge.mjs; todas as classes do core estão no mesmo escopo.
const GBA_WIDTH = 240;
const GBA_HEIGHT = 160;
const AUDIO_BUFFER_SIZE = 16384;
const AUDIO_SAMPLE_RATE = 32768;
const STATE_MAGIC = "EMMUSAVE1";

const TYPED_ARRAYS = [
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array,
];
const TYPED_KIND = new Map(TYPED_ARRAYS.map((ctor, index) => [ctor.name, index]));

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const TAG_NULL = 0;
const TAG_UNDEFINED = 1;
const TAG_BOOLEAN = 2;
const TAG_NUMBER = 3;
const TAG_STRING = 4;
const TAG_ARRAY = 5;
const TAG_OBJECT = 6;
const TAG_BUFFER = 7;
const TAG_TYPED = 8;
const TAG_REF = 9;

class StateEncoder {
  constructor() {
    this.parts = [];
    this.refs = new Map();
  }

  u8(value) {
    const bytes = new Uint8Array(1);
    bytes[0] = value;
    this.parts.push(bytes);
  }

  u32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    this.parts.push(bytes);
  }

  f64(value) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    this.parts.push(bytes);
  }

  raw(bytes) {
    this.u32(bytes.byteLength);
    this.parts.push(bytes);
  }

  string(value) {
    const bytes = textEncoder.encode(value);
    this.raw(bytes);
  }

  async write(value) {
    if (value === null) {
      this.u8(TAG_NULL);
      return;
    }
    if (value === undefined) {
      this.u8(TAG_UNDEFINED);
      return;
    }
    switch (typeof value) {
      case "boolean":
        this.u8(TAG_BOOLEAN);
        this.u8(value ? 1 : 0);
        return;
      case "number":
        this.u8(TAG_NUMBER);
        this.f64(value);
        return;
      case "string":
        this.u8(TAG_STRING);
        this.string(value);
        return;
      default:
        break;
    }

    if (this.refs.has(value)) {
      this.u8(TAG_REF);
      this.u32(this.refs.get(value));
      return;
    }
    const id = this.refs.size;
    this.refs.set(value, id);

    if (value instanceof Blob) {
      this.u8(TAG_BUFFER);
      this.raw(new Uint8Array(await value.arrayBuffer()));
      return;
    }
    if (value instanceof ArrayBuffer) {
      this.u8(TAG_BUFFER);
      this.raw(new Uint8Array(value));
      return;
    }
    if (ArrayBuffer.isView(value)) {
      const kind = TYPED_KIND.get(value.constructor.name);
      if (kind === undefined) throw new Error(`TypedArray não suportado: ${value.constructor.name}`);
      this.u8(TAG_TYPED);
      this.u8(kind);
      this.raw(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      return;
    }
    if (Array.isArray(value)) {
      this.u8(TAG_ARRAY);
      this.u32(value.length);
      for (const item of value) await this.write(item);
      return;
    }

    const keys = Object.keys(value);
    this.u8(TAG_OBJECT);
    this.u32(keys.length);
    for (const key of keys) {
      this.string(key);
      await this.write(value[key]);
    }
  }

  finish() {
    const total = this.parts.reduce((sum, part) => sum + part.byteLength, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of this.parts) {
      result.set(part, offset);
      offset += part.byteLength;
    }
    return result;
  }
}

class StateDecoder {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
    this.refs = [];
  }

  u8() {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  u32() {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f64() {
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  raw() {
    const length = this.u32();
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  string() {
    return textDecoder.decode(this.raw());
  }

  read() {
    const tag = this.u8();
    switch (tag) {
      case TAG_NULL: return null;
      case TAG_UNDEFINED: return undefined;
      case TAG_BOOLEAN: return this.u8() !== 0;
      case TAG_NUMBER: return this.f64();
      case TAG_STRING: return this.string();
      case TAG_BUFFER: return this.raw().buffer;
      case TAG_TYPED: {
        const ctor = TYPED_ARRAYS[this.u8()];
        const bytes = this.raw();
        return new ctor(bytes.buffer, bytes.byteOffset, bytes.byteLength / ctor.BYTES_PER_ELEMENT);
      }
      case TAG_REF: return this.refs[this.u32()];
      case TAG_ARRAY: {
        const length = this.u32();
        const result = new Array(length);
        this.refs.push(result);
        for (let i = 0; i < length; i += 1) result[i] = this.read();
        return result;
      }
      case TAG_OBJECT: {
        const length = this.u32();
        const result = {};
        this.refs.push(result);
        for (let i = 0; i < length; i += 1) {
          const key = this.string();
          result[key] = this.read();
        }
        return result;
      }
      default:
        throw new Error(`Tag de save state desconhecida: ${tag}`);
    }
  }
}

function cloneTyped(array) {
  return new array.constructor(array);
}

function paletteSnapshot(renderer) {
  const palette = new Uint16Array(512);
  for (let i = 0; i < 512; i += 1) {
    palette[i] = renderer.palette.colors[i >> 8][i & 0xff];
  }
  return palette;
}

// O wasm-bindgen importa funções livres com o nome externo declarado em Rust.
// Elas recebem a instância criada pelo construtor importado.
export function step(core, renderGraphics) {
  core.step(renderGraphics);
}

export function frame(core) {
  return core.frame();
}

export function audio(core) {
  return core.audio();
}

export function audioSampleRate() {
  return AUDIO_SAMPLE_RATE;
}

export function audioChannels() {
  return 2;
}

export function setButton(core, button, pressed, player) {
  core.setButton(button, pressed, player);
}

export function setVolume(core, volume) {
  core.setVolume(volume);
}

export function restart(core) {
  core.restart();
}

export async function saveState(core) {
  return core.saveState();
}

export function loadState(core, bytes) {
  core.loadState(bytes);
}

export class GbaCoreBridge {
  constructor(romBytes) {
    const rom = new Uint8Array(romBytes.byteLength);
    rom.set(romBytes instanceof Uint8Array ? romBytes : new Uint8Array(romBytes));

    this.rom = rom.buffer;
    this.gba = new GameBoyAdvance();
    this.gba.setBios(biosBin, false);

    // Sem AudioContext dentro do worker, o core não cria os buffers. Criamos
    // os nossos para capturar o PCM gerado a cada frame.
    const audio = this.gba.audio;
    audio.buffers = [
      new Float32Array(AUDIO_BUFFER_SIZE),
      new Float32Array(AUDIO_BUFFER_SIZE),
    ];
    audio.maxSamples = AUDIO_BUFFER_SIZE;
    audio.sampleMask = AUDIO_BUFFER_SIZE - 1;
    audio.samplePointer = 0;

    // Backing falso: o renderizador software escreve direto em `pixelData`.
    this.gba.video.setBacking({
      createImageData: (width, height) => ({
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
      }),
      putImageData() {},
    });

    if (!this.gba.setRom(this.rom)) {
      throw new Error("ROM GBA inválida (cabeçalho 0xB2 != 0x96).");
    }

    this.frameBuffer = new Uint8ClampedArray(GBA_WIDTH * GBA_HEIGHT * 4);
    this.gba.video.drawCallback = () => {
      const pixels = this.gba.video.renderPath.pixelData?.data;
      if (pixels && pixels.length === this.frameBuffer.length) {
        this.frameBuffer.set(pixels);
      }
    };
    this.lastFrame = new Uint8ClampedArray(0);
    this.lastAudio = new Float32Array(0);
    this.volume = 1;
  }

  step(renderGraphics) {
    const audio = this.gba.audio;
    const before = audio.samplePointer;
    this.gba.advanceFrame();
    const after = audio.samplePointer;

    let count = (after - before + AUDIO_BUFFER_SIZE) & (AUDIO_BUFFER_SIZE - 1);
    if (count > AUDIO_BUFFER_SIZE / 2) count = AUDIO_BUFFER_SIZE / 2;
    const audioSamples = new Float32Array(count * 2);
    for (let i = 0; i < count; i += 1) {
      const index = (before + i) & (AUDIO_BUFFER_SIZE - 1);
      audioSamples[i * 2] = audio.buffers[0][index] * this.volume;
      audioSamples[i * 2 + 1] = audio.buffers[1][index] * this.volume;
    }
    this.lastAudio = audioSamples;
    this.lastFrame = renderGraphics ? this.frameBuffer.slice() : new Uint8ClampedArray(0);
  }

  frame() {
    return this.lastFrame;
  }

  audio() {
    return this.lastAudio;
  }

  audioSampleRate() {
    return AUDIO_SAMPLE_RATE;
  }

  audioChannels() {
    return 2;
  }

  setButton(button, pressed, player) {
    if (player !== undefined && player !== 1) return;
    const keypad = this.gba.keypad;
    const map = {
      A: keypad.A, B: keypad.B, Start: keypad.START, Select: keypad.SELECT,
      Up: keypad.UP, Down: keypad.DOWN, Left: keypad.LEFT, Right: keypad.RIGHT,
      L: keypad.L, R: keypad.R,
    };
    const bit = map[button];
    if (bit === undefined) return; // X/Y/U/D não existem no GBA
    const mask = 1 << bit;
    if (pressed) keypad.currentDown &= ~mask;
    else keypad.currentDown |= mask;
  }

  setVolume(volume) {
    this.volume = Math.min(1, Math.max(0, Number(volume) || 0));
  }

  restart() {
    const save = this.gba.mmu.save?.view?.buffer;
    const saved = save ? new Uint8Array(save) : null;
    this.gba.setRom(this.rom);
    if (saved && this.gba.mmu.save) {
      const copy = new ArrayBuffer(saved.byteLength);
      new Uint8Array(copy).set(saved);
      this.gba.mmu.save.replaceData(copy);
    }
  }

  async saveState() {
    const renderer = this.gba.video.renderPath;
    const save = this.gba.mmu.save?.view?.buffer;
    const frost = this.gba.freeze();
    frost.emmu = {
      magic: STATE_MAGIC,
      keypad: this.gba.keypad.currentDown,
      save: save ? new Uint8Array(save) : null,
      palette: paletteSnapshot(renderer),
      vram: cloneTyped(renderer.vram.buffer),
      oam: cloneTyped(renderer.oam.buffer),
    };
    const encoder = new StateEncoder();
    await encoder.write(frost);
    return encoder.finish();
  }

  loadState(bytes) {
    const frost = new StateDecoder(
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    ).read();
    this.gba.defrost(frost);

    const extra = frost.emmu;
    if (!extra || extra.magic !== STATE_MAGIC) {
      throw new Error("Save state GBA inválido.");
    }
    this.gba.keypad.currentDown = extra.keypad;
    if (extra.save && this.gba.mmu.save) {
      const copy = new ArrayBuffer(extra.save.byteLength);
      new Uint8Array(copy).set(extra.save);
      this.gba.mmu.save.replaceData(copy);
    }

    // O renderizador software do core não serializa paleta/VRAM/OAM.
    const renderer = this.gba.video.renderPath;
    renderer.palette.overwrite(extra.palette);
    renderer.vram.insert(0, extra.vram);
    renderer.oam.overwrite(extra.oam);
    renderer.oam.video = renderer;
  }
}
