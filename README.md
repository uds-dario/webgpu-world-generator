# webgpu-world-generator

Boilerplate Vite + TypeScript + Three.js (WebGPU renderer with WebGL fallback optional) to explore a procedural terrain with free-fly camera and GUI controls.

## Requisiti
- Node.js 18+
- GPU con supporto WebGPU nel browser (Chrome/Edge Canary con flag `--enable-unsafe-webgpu`); in alternativa puoi adattare il renderer a WebGL se necessario.

## Comandi
- Sviluppo: `npm install` (se già presenti i moduli, salta) poi `npm run dev`
- Build produzione: `npm run build`
- Anteprima produzione: `npm run preview`

## Deploy
### GitHub Pages
1. Imposta `base` in `vite.config.ts` al nome del repo (già `"/webgpu-world-generator/"`).
2. Esegui `npm run build`.
3. Pubblica la cartella `dist/` su Pages (branch `gh-pages` o tramite GitHub Actions).

### Vercel (alternativa)
1. Configura un nuovo progetto puntando al repo.
2. Comando build: `npm run build`
3. Output dir: `dist`

## Tech notes
- WebGPU: il renderer usa `WebGPURenderer`; se il browser non supporta WebGPU, puoi tornare a `WebGLRenderer` modificando `Renderer.ts`.
- Shader nodes: il terreno usa Three TSL `MeshStandardNodeMaterial` con FBM per displacement e biomi nel fragment.
- Input: camera noclip con Pointer Lock, WASD/Space/Shift/Ctrl.
- GUI: controlli amplitude/frequency e pulsante random seed via `lil-gui`.
