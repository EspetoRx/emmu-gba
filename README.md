# emmu-gba

Ponte **WASM** do Emmu para **Game Boy Advance**. O núcleo de emulação é JavaScript, vendorizado em `vendor/web-gba-emulator` como submodule (`alexcerezo/Web-GBA-Emulator`): uma adaptação web de [endrift/gbajs](https://github.com/endrift/gbajs). No desktop, GBA roda no Mesen via `emmu-mesen-sys`, então todo o código Rust deste crate fica atrás de `cfg(target_arch = "wasm32")`.

## Como funciona

1. `tools/build-bridge.mjs` lê os scripts do core vendorizado em ordem fixa (`util.js`, `core.js`, `arm.js`, `thumb.js`, `mmu.js`, `io.js`, `audio.js`, `video.js`, `video/software.js`, `irq.js`, `keypad.js`, `sio.js`, `savedata.js`, `gpio.js`, `gba.js`, `resources/biosbin.js`).
2. O script aplica patches pequenos (métodos estáticos de `Serializer`, correção de DMA repeat, silenciamento de logs) e gera `js/bridge.js`.
3. `src/bridge.template.js` define `GbaCoreBridge`: renderizador software, captura de áudio estéreo, keypad e codec de save state.
4. `src/lib.rs` expõe `GbaEmulator` via `wasm-bindgen` com a mesma API dos crates `emmu-snes`, `emmu-nes`, `emmu-gbc`, `emmu-gb` e `emmu-pce`.

> `js/bridge.js` é gerado e ignorado pelo git. Sempre rode `node tools/build-bridge.mjs` depois de atualizar o submodule do core.

## API WASM

| Método | Descrição |
| --- | --- |
| `new(rom)` | cria `GameBoyAdvance()`, instala a BIOS embarcada e carrega a ROM |
| `runFrame(renderGraphics)` | retorna `{ frame, audioSamples, audioSampleRate, audioChannels }` |
| `setButton(button, pressed, player)` | `A`, `B`, `Start`, `Select`, `Up`, `Down`, `Left`, `Right`, `L`, `R`; somente `player === 1` |
| `setVolume(volume)` | aplica ganho ao áudio capturado |
| `restart()` | reinicia preservando save RAM |
| `saveState()` | estado assíncrono com magic `EMMUSAVE1` |
| `loadState(bytes)` | restaura o estado, incluindo paleta, VRAM, OAM, keypad e save RAM |
| `audioSampleRate()` | 32.768 Hz |
| `audioChannels()` | 2 |

O estado extra é necessário porque o renderizador software do core não serializa sozinho paleta/VRAM/OAM.

## Especificações

- Frame: **240 × 160**, RGBA8888.
- Áudio: estéreo intercalado a 32.768 Hz, capturado dos buffers software.
- Save RAM: preservada em `restart()` e incluída no save state.
- `X`/`Y` são ignorados (GBA não possui esses botões).

## Árvore de arquivos

```text
emmu-gba/
├── .gitignore                    # /target/, /js/
├── .gitmodules                   # vendor/web-gba-emulator
├── Cargo.toml                    # dependências apenas para wasm32
├── LICENSE                       # MIT, Copyright (c) 2026 EspetoRx
├── LICENSE-WEB-GBA-EMULATOR.txt  # BSD-2-Clause, Copyright (c) 2012 Jeffrey Pfau
├── README.md
├── js/
│   └── bridge.js                 # gerado; não versionado
├── src/
│   ├── bridge.template.js        # GbaCoreBridge + codec de estado
│   └── lib.rs                    # GbaEmulator WASM
├── tools/
│   └── build-bridge.mjs          # concatena/patcha o core JS
└── vendor/
    └── web-gba-emulator/         # submodule @ e760d30e
        ├── README.md
        ├── index.html
        └── js/                   # core original + BIOS embarcada
```

## Build e teste

Dentro do submódulo:

```sh
node tools/build-bridge.mjs
cargo check --target wasm32-unknown-unknown
```

A partir da raiz:

```sh
cargo test -p emmu-gba
```

Pacote WASM usado pela UI (já incluído em `npm run build:wasm`):

```sh
cd crates/emmu-gba
node tools/build-bridge.mjs
wasm-pack build --target web \
  --out-dir ../../platforms/web/ui/src/wasm/gba \
  --out-name emmu_gba
```

Não há testes inline neste crate; a validação real acontece no navegador e no workspace.

## Limitações

- Não há implementação nativa Rust: no desktop, GBA é Mesen.
- Depende de renderização software.
- Somente o jogador 1 é suportado.
- O formato de save state é próprio (`EMMUSAVE1`) e não é compatível com Mesen `.mss`.

## Licenças

| Componente | Licença | Crédito |
| --- | --- | --- |
| `emmu-gba` | MIT | `Copyright (c) 2026 EspetoRx` — `LICENSE` |
| Web-GBA-Emulator / gbajs | BSD-2-Clause | `Copyright (c) 2012, Jeffrey Pfau`; adaptação web por `alexcerezo` — `LICENSE-WEB-GBA-EMULATOR.txt` |
| `wasm-bindgen`, `wasm-bindgen-futures`, `js-sys` | MIT OR Apache-2.0 | rustwasm |

Nenhuma ROM ou BIOS proprietária é distribuída; a BIOS embarcada no core vendorizado é a usada pelo projeto Web-GBA.
