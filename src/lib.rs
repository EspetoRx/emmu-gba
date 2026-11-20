//! Wrapper WASM do core GBA.
//!
//! O core é o Web-GBA-Emulator (JavaScript), vendored em
//! `vendor/web-gba-emulator` e concatenado em `js/bridge.js` por
//! `tools/build-bridge.mjs`. O wasm-bindgen copia esse módulo para o pacote,
//! mantendo a mesma API dos crates `emmu-snes`/`emmu-nes`.
//!
//! No desktop o GBA é executado pelo Mesen via `emmu-mesen-sys`, então não há
//! código nativo neste crate.

#[cfg(target_arch = "wasm32")]
mod wasm {
    use js_sys::{Float32Array, Object, Promise, Reflect, Uint8Array};
    use wasm_bindgen::prelude::*;
    use wasm_bindgen_futures::JsFuture;

    #[wasm_bindgen(module = "/js/bridge.js")]
    extern "C" {
        #[wasm_bindgen(js_name = GbaCoreBridge)]
        type GbaCoreBridge;

        #[wasm_bindgen(constructor)]
        fn new(rom: &[u8]) -> GbaCoreBridge;

        fn step(this: &GbaCoreBridge, render_graphics: bool);
        fn frame(this: &GbaCoreBridge) -> Uint8Array;
        fn audio(this: &GbaCoreBridge) -> Float32Array;
        #[wasm_bindgen(js_name = audioSampleRate)]
        fn audio_sample_rate(this: &GbaCoreBridge) -> u32;
        #[wasm_bindgen(js_name = audioChannels)]
        fn audio_channels(this: &GbaCoreBridge) -> u32;
        #[wasm_bindgen(js_name = setButton)]
        fn set_button(this: &GbaCoreBridge, button: &str, pressed: bool, player: u32);
        #[wasm_bindgen(js_name = setVolume)]
        fn set_volume(this: &GbaCoreBridge, volume: f64);
        fn restart(this: &GbaCoreBridge);
        #[wasm_bindgen(js_name = saveState)]
        fn save_state(this: &GbaCoreBridge) -> Promise;
        #[wasm_bindgen(js_name = loadState)]
        fn load_state(this: &GbaCoreBridge, bytes: &[u8]);
    }

    #[wasm_bindgen]
    pub struct GbaEmulator {
        core: GbaCoreBridge,
    }

    #[wasm_bindgen]
    impl GbaEmulator {
        #[wasm_bindgen(constructor)]
        pub fn new(rom: &[u8]) -> Result<GbaEmulator, JsValue> {
            Ok(Self {
                core: GbaCoreBridge::new(rom),
            })
        }

        #[allow(non_snake_case)]
        pub fn runFrame(&mut self, render_graphics: bool) -> Result<JsValue, JsValue> {
            step(&self.core, render_graphics);

            let result = Object::new();
            Reflect::set(
                &result,
                &JsValue::from_str("frame"),
                &JsValue::from(frame(&self.core)),
            )?;
            Reflect::set(
                &result,
                &JsValue::from_str("audioSamples"),
                &JsValue::from(audio(&self.core)),
            )?;
            Reflect::set(
                &result,
                &JsValue::from_str("audioSampleRate"),
                &JsValue::from_f64(audio_sample_rate(&self.core) as f64),
            )?;
            Reflect::set(
                &result,
                &JsValue::from_str("audioChannels"),
                &JsValue::from_f64(audio_channels(&self.core) as f64),
            )?;
            Ok(result.into())
        }

        #[wasm_bindgen(js_name = setButton)]
        pub fn set_button(&mut self, button: &str, pressed: bool, player: u32) {
            set_button(&self.core, button, pressed, player);
        }

        #[wasm_bindgen(js_name = setVolume)]
        pub fn set_volume(&mut self, volume: f64) {
            set_volume(&self.core, volume);
        }

        pub fn restart(&mut self) {
            restart(&self.core);
        }

        #[wasm_bindgen(js_name = saveState)]
        pub async fn save_state(&mut self) -> Result<Vec<u8>, JsValue> {
            let promise = save_state(&self.core);
            let value = JsFuture::from(promise).await?;
            Ok(Uint8Array::new(&value).to_vec())
        }

        #[wasm_bindgen(js_name = loadState)]
        pub fn load_state(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
            load_state(&self.core, bytes);
            Ok(())
        }

        #[wasm_bindgen(js_name = audioSampleRate)]
        pub fn audio_sample_rate(&self) -> u32 {
            audio_sample_rate(&self.core)
        }

        #[wasm_bindgen(js_name = audioChannels)]
        pub fn audio_channels(&self) -> u32 {
            audio_channels(&self.core)
        }
    }
}
