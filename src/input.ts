import {
  Mesh,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
} from "three";

export type PickInfo = {
  worldPosition: Vector3;
  uv: Vector2;
  button: number;
  buttons: number;
  ctrlKey: boolean;
  shiftKey: boolean;
};

export function setupInput(
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  terrainMesh: Mesh,
  onPick: (info: PickInfo) => void,
) {
  const raycaster = new Raycaster();
  const pointer = new Vector2();

  function handlePointer(event: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObject(terrainMesh);
    if (!hit || !hit.uv) return;

    onPick({
      worldPosition: hit.point.clone(),
      uv: hit.uv.clone(),
      button: event.button,
      buttons: event.buttons,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
    });
  }

  canvas.addEventListener("mousemove", handlePointer);
  canvas.addEventListener("mousedown", handlePointer);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
}
