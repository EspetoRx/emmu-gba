// Gera js/bridge.js: um único módulo ES com o core GBA (scripts clássicos do
// Web-GBA-Emulator) seguido da nossa API. Assim o wasm-bindgen pode copiar um
// único arquivo para o pacote WASM, sem importações relativas frágeis.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "vendor", "web-gba-emulator");

// Ordem de carregamento de index.html, sem main.js/xhr.js (UI do app original)
// e sem video/proxy.js (forçamos o renderizador software, que é o único com
// acesso direto ao framebuffer 240x160).
const sources = [
  "js/util.js",
  "js/core.js",
  "js/arm.js",
  "js/thumb.js",
  "js/mmu.js",
  "js/io.js",
  "js/audio.js",
  "js/video.js",
  "js/video/software.js",
  "js/irq.js",
  "js/keypad.js",
  "js/sio.js",
  "js/savedata.js",
  "js/gpio.js",
  "js/gba.js",
  "resources/biosbin.js",
];

// `console` local silencia os logs do core vendored sem alterar o submodule.
const preamble = `// ARQUIVO GERADO por tools/build-bridge.mjs — não editar.\nconst console = { log() {}, info() {}, warn() {}, error() {}, debug() {}, trace() {} };\nif (typeof globalThis.window === "undefined") globalThis.window = globalThis;\n\n`;

const body = sources
  .map((name) => {
    const source = readFileSync(join(vendor, name), "utf8");
    // O core ainda tem um resíduo de protótipos do tempo do Prototype.js.
    // A classe já usa `extends`, e a atribuição ao `.prototype` de uma class
    // lança TypeError dentro de um módulo ES (strict mode).
    let patched = source.replace(
      /^GameBoyAdvanceOAM\.prototype = Object\.create\(MemoryAligned16\.prototype\);$/m,
      "",
    );
    if (name === "js/util.js") {
      // O core chama métodos de Serializer como se fossem estáticos.
      patched +=
        "\nfor (const name of ['pack', 'pack8', 'prefix', 'serialize', 'deserialize', 'deserealizeStream']) {\n  Serializer[name] = Serializer.prototype[name];\n}\n";
    }
    if (name === "js/mmu.js") {
      // Um DMA com timing NOW e repeat reagenda a si mesmo em serviceDma(),
      // causando recursão infinita em ROMs que usam esse padrão. No hardware
      // esse modo não se repete; somente DMAs sincronizados devem voltar à fila.
      const oldRepeat = "\t\t} else {\n\t\t\tinfo.nextCount = info.count;\n\t\t\tif (info.dstControl == this.DMA_INCREMENT_RELOAD) {\n\t\t\t\tinfo.nextDest = info.dest;\n\t\t\t}\n\t\t\tthis.scheduleDma(number, info);\n\t\t}";
      const newRepeat = "\t\t} else {\n\t\t\tinfo.nextCount = info.count;\n\t\t\tif (info.dstControl == this.DMA_INCREMENT_RELOAD) {\n\t\t\t\tinfo.nextDest = info.dest;\n\t\t\t}\n\t\t\tif (info.timing !== this.DMA_TIMING_NOW) {\n\t\t\t\tthis.scheduleDma(number, info);\n\t\t\t}\n\t\t}";
      if (!patched.includes(oldRepeat)) {
        throw new Error("Patch de DMA não aplicado: js/mmu.js mudou no submodule.");
      }
      patched = patched.replace(oldRepeat, newRepeat);
    }
    return `// --- ${name} ---\n${patched}`;
  })
  .join("\n\n");

const template = readFileSync(join(root, "src", "bridge.template.js"), "utf8");
const out = join(root, "js", "bridge.js");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${preamble}${body}\n\n// --- bridge.template.js ---\n${template}\n`);
