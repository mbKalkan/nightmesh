// The mesh check of a glTF model, off the webview's main thread: a few hundred milliseconds for
// millions of triangles. Started from a blob: URL, the only kind the CSP allows (D-008).
import { checkMesh, placeMeshes, type PlacedMesh } from '../shared/meshCheck';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PlacedMesh[]>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = ({ data }) => {
  let check;
  try {
    check = checkMesh(placeMeshes(data));
  } catch (error) {
    // The check is extra: without it the model is still shown.
    console.warn(error);
  }
  scope.postMessage(check ?? null);
};
