# emmu-gba

Core GBA para a versão web. Os fontes JavaScript vêm do submodule
`vendor/web-gba-emulator` (adaptation de alexcerezo para endrift/gbajs).

`tools/build-bridge.mjs` concatena os scripts clássicos do core em
`js/bridge.js`, expondo uma API compatível com `emmu-snes`/`emmu-nes`:

- `runFrame(renderGraphics)` → `{ frame, audioSamples, audioSampleRate, audioChannels }`
- `setButton(button, pressed, player)`
- `saveState()` / `loadState(bytes)`
- `restart()` / `setVolume(volume)`

No desktop o GBA continua rodando no Mesen via `emmu-mesen-sys`.

Licença do core vendored: veja `LICENSE-WEB-GBA-EMULATOR.txt`.
