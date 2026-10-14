// Turns a model file into the messages that bring it to the webview. Free of VS Code APIs, so
// the browser tests can feed the webview exactly what the extension host would.
import { DRAWN_EXTENSIONS } from '../../shared/gltfExtensions';
import type { HostToWebviewMessage, ImageInfo } from '../../shared/protocol';
import { MAX_JSON_BYTES, readGlbLayout, sniff, withoutByteOrderMark } from './container';
import { animationMotion } from './animationMotion';
import { IMAGE_HEADER_BYTES, readImageInfo } from './imageInfo';
import { planRender, type Gltf, type Part, type RenderPlan, type ResourceData } from './plan';
import { resourceName } from './resources';
import type { ByteSource } from './sources';

/** Why a resource the model refers to isn't there. */
export type ResourceProblem =
  'missing' | 'network' | 'absolute' | 'outside' | 'invalid' | 'unreadable';

/** Opens what a URI in the model points to (`data:` or relative), or says why it can't. */
export type ResourceOpener = (uri: string) => Promise<ByteSource | ResourceProblem>;

/** Sentences for the user, localized by the caller. */
export interface LoadTexts {
  empty: string;
  damaged: string;
  lfsPointer: string;
  version(version: string): string;
  extensions(names: string): string;
  nothingDrawn: string;
  resource(problem: ResourceProblem, name: string): string;
  truncated: string;
  dropped(kind: 'primitives' | 'textures' | 'animations', count: number): string;
}

export interface LoadOptions {
  loadId: number;
  reload: boolean;
  texts: LoadTexts;
}

/** Parts at least this big travel alone; smaller ones are packed together. */
const SMALL_PART = 1024 * 1024;
/** Packs and lone parts are sent in messages of about this size. */
const MESSAGE_BYTES = 16 * 1024 * 1024;

/**
 * Yields the messages for one load of `source`. Stop iterating to cancel: resources opened on
 * the way are closed either way. `source` itself stays open; it belongs to the caller.
 */
export async function* loadMessages(
  source: ByteSource,
  openResource: ResourceOpener,
  { loadId, reload, texts }: LoadOptions,
): AsyncGenerator<HostToWebviewMessage> {
  const failed = (message: string, details: string[] = []): HostToWebviewMessage => ({
    type: 'failed',
    loadId,
    reload,
    message,
    details,
  });

  const head = await source.read(0, Math.min(64, source.size));
  const kind = sniff(head);
  if (kind === 'empty') return yield failed(texts.empty);
  if (kind === 'lfsPointer') return yield failed(texts.lfsPointer);
  if (kind === 'unknown') return yield failed(texts.damaged);

  let text: string;
  let bin: ResourceData | undefined;
  let chunks: { json: number; bin?: number } | undefined;
  let truncated = false;
  if (kind === 'glb') {
    const layout = await readGlbLayout(source);
    if ('failure' in layout) {
      return yield failed(
        layout.failure === 'version' ? texts.version(String(layout.version)) : texts.damaged,
      );
    }
    text = new TextDecoder().decode(await source.read(layout.json.offset, layout.json.length));
    chunks = { json: layout.json.length, bin: layout.bin?.length };
    if (layout.bin) {
      bin = { source, offset: layout.bin.offset, available: layout.bin.available };
    }
    truncated = layout.truncated;
  } else {
    if (source.size > MAX_JSON_BYTES) return yield failed(texts.damaged);
    text = new TextDecoder().decode(await source.read(0, source.size));
  }

  text = withoutByteOrderMark(text);
  let json: Gltf;
  try {
    json = JSON.parse(text) as Gltf;
  } catch {
    return yield failed(texts.damaged);
  }
  if (!json || typeof json !== 'object' || typeof json.asset?.version !== 'string') {
    return yield failed(texts.damaged);
  }
  if (!json.asset.version.startsWith('2.')) return yield failed(texts.version(json.asset.version));
  // The structure shows right away, and stays when the model can't be drawn.
  yield { type: 'structure', loadId, reload, json: text, fileSize: source.size, chunks };
  const missing = (json.extensionsRequired ?? []).filter((name) => !DRAWN_EXTENSIONS.has(name));
  if (missing.length > 0) return yield failed(texts.extensions(missing.join(', ')));

  const opened = new Map<string, Promise<ByteSource | ResourceProblem>>();
  const problems = new Map<string, string>();
  const resource = async (uri: string): Promise<ResourceData | undefined> => {
    if (!opened.has(uri)) opened.set(uri, openResource(uri));
    const result = await opened.get(uri)!;
    if (typeof result === 'string') {
      problems.set(uri, texts.resource(result, resourceName(uri)));
      return undefined;
    }
    return { source: result, offset: 0, available: result.size };
  };

  try {
    const buffers = await Promise.all(
      (json.buffers ?? []).map((buffer, index) =>
        buffer.uri !== undefined
          ? resource(buffer.uri)
          : index === 0 && kind === 'glb'
            ? bin
            : undefined,
      ),
    );
    const images = await Promise.all(
      (json.images ?? []).map((image) =>
        image.uri !== undefined ? resource(image.uri) : undefined,
      ),
    );
    const plan = planRender(json, buffers, images);
    yield { type: 'images', loadId, images: await imageInfos(plan) };
    if (plan.json.animations?.length) {
      yield { type: 'animations', loadId, motion: await animationMotion(plan) };
    }

    const notices = [...problems.values()];
    if (truncated) notices.push(texts.truncated);
    if (!plan.drawable) return yield failed(texts.nothingDrawn, notices);
    for (const kind of ['primitives', 'textures', 'animations'] as const) {
      if (plan.dropped[kind] > 0) notices.push(texts.dropped(kind, plan.dropped[kind]));
    }

    yield {
      type: 'model',
      loadId,
      reload,
      json: JSON.stringify(plan.json),
      extensions: json.extensionsUsed ?? [],
      parts: plan.parts.length,
      bytes: plan.bytes,
      notices,
    };
    yield* partMessages(plan.parts, loadId);
  } finally {
    for (const result of opened.values()) {
      const value = await result;
      if (typeof value !== 'string') await value.close();
    }
  }
}

/** Sizes of the images the plan sends, read from the start of each one's bytes. */
async function imageInfos(plan: RenderPlan): Promise<(ImageInfo | null)[]> {
  const parts = new Map(plan.parts.map((part) => [part.key, part]));
  return Promise.all(
    (plan.json.images ?? []).map(async (image) => {
      const part = parts.get(`bufferView:${image.bufferView}`);
      if (image.bufferView === undefined || !part) return null;
      const head = await part.source.read(part.offset, Math.min(part.length, IMAGE_HEADER_BYTES));
      return readImageInfo(head) ?? null;
    }),
  );
}

async function* partMessages(parts: Part[], loadId: number): AsyncGenerator<HostToWebviewMessage> {
  let keys: string[] = [];
  let pieces: Uint8Array[] = [];
  let packed = 0;
  const pack = (): HostToWebviewMessage => {
    const data = new Uint8Array(packed);
    const offsets: number[] = [];
    let offset = 0;
    for (const piece of pieces) {
      offsets.push(offset);
      data.set(piece, offset);
      offset += piece.length;
    }
    const message: HostToWebviewMessage = { type: 'parts', loadId, keys, offsets, data };
    keys = [];
    pieces = [];
    packed = 0;
    return message;
  };

  for (const part of parts) {
    const data = await part.source.read(part.offset, part.length);
    if (part.length >= SMALL_PART) {
      yield { type: 'part', loadId, key: part.key, data };
      continue;
    }
    keys.push(part.key);
    pieces.push(data);
    packed += part.length;
    if (packed >= MESSAGE_BYTES) yield pack();
  }
  if (keys.length > 0) yield pack();
}
