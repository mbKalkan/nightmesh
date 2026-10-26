// Writes the sample models in test/fixtures from code, so they are small, deterministic and free
// to share. Run `npm run fixtures` after changing this file and commit the results.
//   --out <dir>  write somewhere else (the unit tests regenerate into a temporary folder)
//   --large      also write generated/large.glb, a 2-million-triangle model for performance checks
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { Camera, Document, Format, Logger, NodeIO, Primitive } from '@gltf-transform/core';
import {
  ALL_EXTENSIONS,
  EXTMeshGPUInstancing,
  KHRLightsPunctual,
  KHRMaterialsClearcoat,
  KHRMaterialsEmissiveStrength,
  KHRMaterialsIOR,
  KHRMaterialsTransmission,
  KHRMaterialsUnlit,
  KHRMaterialsVariants,
  KHRTextureBasisu,
  KHRTextureTransform,
  Light,
} from '@gltf-transform/extensions';
import { draco, meshopt, quantize } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { encodeToKTX2 } from 'ktx2-encoder';
import { MeshoptEncoder } from 'meshoptimizer';

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const OUT = argument('--out') ?? 'test/fixtures';
const LARGE = process.argv.includes('--large');
const GENERATOR = 'Nightmesh fixture generator';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.encoder': MeshoptEncoder,
});

// Geometry

/** A cube of `size` metres centred on the origin, with a face per side for flat normals and UVs. */
function boxGeometry(size = 1) {
  const h = size / 2;
  const faces = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (const { n, u, v } of faces) {
    const base = positions.length / 3;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      for (let i = 0; i < 3; i++) positions.push((n[i] + su * u[i] + sv * v[i]) * h);
      normals.push(...n);
      uvs.push((su + 1) / 2, 1 - (sv + 1) / 2);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, uvs, indices };
}

/** A UV sphere of `radius` with `segments` around and `rings` from pole to pole. */
function sphereGeometry(radius = 0.5, segments = 32, rings = 16) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let r = 0; r <= rings; r++) {
    const theta = (r / rings) * Math.PI;
    for (let s = 0; s <= segments; s++) {
      const phi = (s / segments) * Math.PI * 2;
      const n = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
      positions.push(...n.map((c) => c * radius));
      normals.push(...n);
      uvs.push(s / segments, r / rings);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;
      if (r > 0) indices.push(a, a + 1, b);
      if (r < rings - 1) indices.push(a + 1, b + 1, b);
    }
  }
  return { positions, normals, uvs, indices };
}

/** A flat `size` × `size` grid in the XZ plane split into `cells` × `cells` squares. */
function gridGeometry(cells, size = 10) {
  const count = (cells + 1) * (cells + 1);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  for (let z = 0, i = 0; z <= cells; z++) {
    for (let x = 0; x <= cells; x++, i++) {
      positions.set([(x / cells - 0.5) * size, 0, (z / cells - 0.5) * size], i * 3);
      normals.set([0, 1, 0], i * 3);
      uvs.set([x / cells, z / cells], i * 2);
    }
  }
  const indices = new Uint32Array(cells * cells * 6);
  for (let z = 0, i = 0; z < cells; z++) {
    for (let x = 0; x < cells; x++, i += 6) {
      const a = z * (cells + 1) + x;
      const b = a + cells + 1;
      indices.set([a, b, a + 1, a + 1, b, b + 1], i);
    }
  }
  return { positions, normals, uvs, indices };
}

// Document helpers

function newDocument() {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  doc.getRoot().getAsset().generator = GENERATOR;
  doc.getRoot().getAsset().copyright = 'Public domain (CC0 1.0)';
  doc.createBuffer();
  return doc;
}

function accessor(doc, type, array) {
  return doc
    .createAccessor()
    .setType(type)
    .setArray(array)
    .setBuffer(doc.getRoot().listBuffers()[0]);
}

function meshPrimitive(doc, geometry, material) {
  const primitive = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor(doc, 'VEC3', new Float32Array(geometry.positions)))
    .setAttribute('NORMAL', accessor(doc, 'VEC3', new Float32Array(geometry.normals)))
    .setAttribute('TEXCOORD_0', accessor(doc, 'VEC2', new Float32Array(geometry.uvs)))
    .setIndices(accessor(doc, 'SCALAR', indexArray(geometry)));
  if (material) primitive.setMaterial(material);
  return primitive;
}

function indexArray({ indices, positions }) {
  if (indices instanceof Uint32Array || indices instanceof Uint16Array) return indices;
  return positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
}

function mesh(doc, name, geometry, material) {
  return doc.createMesh(name).addPrimitive(meshPrimitive(doc, geometry, material));
}

function scene(doc, name, ...nodes) {
  const result = doc.createScene(name);
  nodes.forEach((node) => result.addChild(node));
  if (!doc.getRoot().getDefaultScene()) doc.getRoot().setDefaultScene(result);
  return result;
}

const quaternionY = (angle) => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
const quaternionZ = (angle) => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];

// Textures

/** An RGBA PNG; `pixel(x, y)` returns [r, g, b, a] in 0–255. */
function png(width, height, pixel) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rows.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Squares of 8 × 8 texels, light and `dark`. */
const squares =
  (dark = [52, 120, 220, 255]) =>
  (x, y) =>
    ((x >> 3) + (y >> 3)) % 2 === 0 ? [235, 235, 235, 255] : dark;

const checker = () => png(64, 64, squares());

/**
 * A KTX2 texture compressed with Basis Universal: ETC1S, or with `uastc` UASTC and Zstandard
 * supercompression, the two kinds glTF models carry.
 */
async function ktx2(width, height, pixel, { uastc = false } = {}) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return encodeToKTX2(data, {
    imageDecoder: async () => ({ width, height, data }),
    isUASTC: uastc,
    needSupercompression: uastc,
    generateMipmap: true,
  });
}

/** A normal map of soft round bumps. */
const bumps = () =>
  png(64, 64, (x, y) => {
    const dx = Math.sin((x / 64) * Math.PI * 8) * 0.35;
    const dy = Math.sin((y / 64) * Math.PI * 8) * 0.35;
    const length = Math.hypot(dx, dy, 1);
    return [
      ((dx / length) * 0.5 + 0.5) * 255,
      ((dy / length) * 0.5 + 0.5) * 255,
      (0.5 / length + 0.5) * 255,
      255,
    ].map(Math.round);
  });

/** Opaque where the checker is light, transparent where it's dark, for alpha masks. */
const holes = () =>
  png(64, 64, (x, y) =>
    ((x >> 3) + (y >> 3)) % 2 === 0 ? [255, 255, 255, 255] : [255, 255, 255, 0],
  );

/** Ambient occlusion, darker toward the edges. */
const shade = () =>
  png(64, 64, (x, y) => {
    const value = Math.round(255 - Math.hypot(x - 31.5, y - 31.5) * 3);
    return [value, value, value, 255];
  });

function texture(doc, name, bytes) {
  return doc.createTexture(name).setImage(bytes).setMimeType('image/png').setURI(`${name}.png`);
}

// Models

/** One triangle in the XY plane, one metre on each side, with nothing else. */
function triangle() {
  const doc = newDocument();
  const primitive = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor(doc, 'VEC3', new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])))
    .setIndices(accessor(doc, 'SCALAR', new Uint16Array([0, 1, 2])));
  const node = doc
    .createNode('Triangle')
    .setMesh(doc.createMesh('Triangle').addPrimitive(primitive));
  scene(doc, 'Scene', node);
  return doc;
}

/** A node hierarchy with meshes, lines and points, cameras, lights and a second scene. */
/**
 * Box, Sphere and a Group of a small box and points, with cameras and a light. `edited` is the
 * next version of it, to compare: the box moves, the points go, a tall box comes, the clay turns
 * blue.
 */
function sceneModel({ edited = false } = {}) {
  const doc = newDocument();
  const material = doc
    .createMaterial('Clay')
    .setBaseColorFactor(edited ? [0.55, 0.65, 0.8, 1] : [0.8, 0.75, 0.7, 1])
    .setRoughnessFactor(0.8);
  const box = mesh(doc, 'Box', boxGeometry(1), material);
  const sphere = mesh(doc, 'Sphere', sphereGeometry(0.5), material);

  const axes = doc.createMesh('Axes').addPrimitive(
    doc
      .createPrimitive()
      .setMode(Primitive.Mode.LINES)
      .setAttribute(
        'POSITION',
        accessor(
          doc,
          'VEC3',
          new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]),
        ),
      )
      .setAttribute(
        'COLOR_0',
        accessor(
          doc,
          'VEC3',
          new Float32Array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1]),
        ),
      ),
  );
  const points = [];
  for (let i = 0; i < 64; i++)
    points.push(Math.cos(i * 0.7) * 0.6, (i / 64) * 1.2, Math.sin(i * 0.7) * 0.6);
  const cloud = doc.createMesh('Cloud').addPrimitive(
    doc
      .createPrimitive()
      .setMode(Primitive.Mode.POINTS)
      .setAttribute('POSITION', accessor(doc, 'VEC3', new Float32Array(points))),
  );

  const root = doc.createNode('Root').setExtras({ note: 'Extras appear in the inspector.' });
  root.addChild(
    doc
      .createNode('Box')
      .setMesh(box)
      .setTranslation([-1.5, 0.5, edited ? 0.75 : 0]),
  );
  root.addChild(
    doc
      .createNode('Sphere')
      .setMesh(sphere)
      .setTranslation([0, 0.5, 0])
      .setRotation(quaternionY(Math.PI / 4))
      .setScale([1.2, 1.2, 1.2]),
  );
  const group = doc.createNode('Group').setTranslation([1.5, 0, 0]);
  group.addChild(
    doc.createNode('Small Box').setMesh(box).setTranslation([0, 0.25, 0]).setScale([0.5, 0.5, 0.5]),
  );
  if (edited) {
    group.addChild(
      doc.createNode('Tall Box').setMesh(box).setTranslation([0, 0.5, 0]).setScale([0.4, 1, 0.4]),
    );
    // The points' mesh goes with them.
    for (const primitive of cloud.listPrimitives()) primitive.getAttribute('POSITION').dispose();
    cloud.dispose();
  } else {
    group.addChild(doc.createNode('Points').setMesh(cloud).setTranslation([0, 0.5, 0]));
  }
  root.addChild(group);
  root.addChild(doc.createNode('Axes').setMesh(axes));

  const perspective = doc
    .createCamera('Perspective')
    .setType(Camera.Type.PERSPECTIVE)
    .setYFov(0.8)
    .setAspectRatio(1.5)
    .setZNear(0.1)
    .setZFar(100);
  const orthographic = doc
    .createCamera('Top')
    .setType(Camera.Type.ORTHOGRAPHIC)
    .setXMag(3)
    .setYMag(2)
    .setZNear(0.1)
    .setZFar(50);
  root.addChild(doc.createNode('Front Camera').setCamera(perspective).setTranslation([0, 1, 6]));
  root.addChild(
    doc
      .createNode('Top Camera')
      .setCamera(orthographic)
      .setTranslation([0, 10, 0])
      .setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]),
  );

  const lights = doc.createExtension(KHRLightsPunctual);
  const sun = lights
    .createLight('Sun')
    .setType(Light.Type.DIRECTIONAL)
    .setIntensity(3)
    .setColor([1, 0.95, 0.85]);
  const lamp = lights.createLight('Lamp').setType(Light.Type.POINT).setIntensity(20).setRange(10);
  const spot = lights
    .createLight('Spot')
    .setType(Light.Type.SPOT)
    .setIntensity(40)
    .setInnerConeAngle(0.3)
    .setOuterConeAngle(0.6);
  root.addChild(
    doc
      .createNode('Sun')
      .setExtension('KHR_lights_punctual', sun)
      .setRotation([-0.3826834, 0, 0, 0.9238795]),
  );
  root.addChild(
    doc.createNode('Lamp').setExtension('KHR_lights_punctual', lamp).setTranslation([2, 2, 2]),
  );
  root.addChild(
    doc
      .createNode('Spot')
      .setExtension('KHR_lights_punctual', spot)
      .setTranslation([-2, 3, 0])
      .setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]),
  );

  scene(doc, 'Main', root);
  scene(doc, 'Sphere Only', doc.createNode('Lonely Sphere').setMesh(sphere));
  return doc;
}

/** A row of spheres, one per kind of material the inspector shows. */
/** Three boxes, a metre each and two metres apart, drawn as instances of one mesh. */
function instanced() {
  const doc = newDocument();
  const material = doc.createMaterial('Clay').setBaseColorFactor([0.8, 0.75, 0.7, 1]);
  const box = mesh(doc, 'Box', boxGeometry(1), material);
  const instances = doc
    .createExtension(EXTMeshGPUInstancing)
    .setRequired(true)
    .createInstancedMesh()
    .setAttribute(
      'TRANSLATION',
      accessor(doc, 'VEC3', new Float32Array([-2, 0.5, 0, 0, 0.5, 0, 2, 0.5, 0])),
    );
  scene(
    doc,
    'Instances',
    doc.createNode('Boxes').setMesh(box).setExtension('EXT_mesh_gpu_instancing', instances),
  );
  return doc;
}

function materials() {
  const doc = newDocument();
  const sphere = sphereGeometry(0.4, 32, 16);
  const checkerTexture = texture(doc, 'checker', checker());
  const transform = doc.createExtension(KHRTextureTransform);
  const clearcoat = doc.createExtension(KHRMaterialsClearcoat);
  const transmission = doc.createExtension(KHRMaterialsTransmission);
  const ior = doc.createExtension(KHRMaterialsIOR);
  const unlit = doc.createExtension(KHRMaterialsUnlit);
  const emissiveStrength = doc.createExtension(KHRMaterialsEmissiveStrength);

  const textured = doc
    .createMaterial('Checker')
    .setBaseColorTexture(checkerTexture)
    .setNormalTexture(texture(doc, 'bumps', bumps()))
    .setRoughnessFactor(0.6)
    .setMetallicFactor(0);
  textured
    .getBaseColorTextureInfo()
    .setExtension('KHR_texture_transform', transform.createTransform().setScale([2, 2]));
  // As some exporters write it: occlusion on the second UV set, with a transform saying so.
  textured
    .setOcclusionTexture(texture(doc, 'shade', shade()))
    .getOcclusionTextureInfo()
    .setTexCoord(1)
    .setExtension('KHR_texture_transform', transform.createTransform().setTexCoord(1));

  const list = [
    textured,
    doc
      .createMaterial('Gold')
      .setBaseColorFactor([1, 0.77, 0.34, 1])
      .setMetallicFactor(1)
      .setRoughnessFactor(0.25),
    doc
      .createMaterial('Car Paint')
      .setBaseColorFactor([0.6, 0.05, 0.05, 1])
      .setMetallicFactor(0.3)
      .setRoughnessFactor(0.5)
      .setExtension(
        'KHR_materials_clearcoat',
        clearcoat.createClearcoat().setClearcoatFactor(1).setClearcoatRoughnessFactor(0.05),
      ),
    doc
      .createMaterial('Glass')
      .setRoughnessFactor(0.05)
      .setMetallicFactor(0)
      .setExtension(
        'KHR_materials_transmission',
        transmission.createTransmission().setTransmissionFactor(1),
      )
      .setExtension('KHR_materials_ior', ior.createIOR().setIOR(1.5)),
    doc
      .createMaterial('Unlit')
      .setBaseColorFactor([0.2, 0.8, 0.4, 1])
      .setExtension('KHR_materials_unlit', unlit.createUnlit()),
    doc.createMaterial('Translucent').setBaseColorFactor([0.3, 0.5, 1, 0.5]).setAlphaMode('BLEND'),
    doc
      .createMaterial('Cutout')
      .setBaseColorTexture(texture(doc, 'holes', holes()))
      .setAlphaMode('MASK')
      .setAlphaCutoff(0.5)
      .setDoubleSided(true),
    doc
      .createMaterial('Glow')
      .setBaseColorFactor([0, 0, 0, 1])
      .setEmissiveFactor([1, 0.5, 0.1])
      .setExtension(
        'KHR_materials_emissive_strength',
        emissiveStrength.createEmissiveStrength().setEmissiveStrength(4),
      ),
  ];

  // All spheres share one set of vertex data; only the material differs.
  const shared = meshPrimitive(doc, sphere);
  shared.setAttribute('TEXCOORD_1', accessor(doc, 'VEC2', new Float32Array(sphere.uvs)));
  const nodes = list.map((material, i) =>
    doc
      .createNode(material.getName())
      .setMesh(
        doc.createMesh(material.getName()).addPrimitive(shared.clone().setMaterial(material)),
      )
      .setTranslation([(i - (list.length - 1) / 2) * 1, 0.4, 0]),
  );

  // Vertex colors instead of a material color.
  const colored = mesh(doc, 'Vertex Colors', boxGeometry(0.7), doc.createMaterial('Vertex Colors'));
  const colors = [];
  const { positions } = boxGeometry(0.7);
  for (let i = 0; i < positions.length; i += 3)
    colors.push(positions[i] + 0.5, positions[i + 1] + 0.5, positions[i + 2] + 0.5, 1);
  colored
    .listPrimitives()[0]
    .setAttribute('COLOR_0', accessor(doc, 'VEC4', new Float32Array(colors)));
  nodes.push(doc.createNode('Vertex Colors').setMesh(colored).setTranslation([0, 0.35, 1.5]));

  scene(doc, 'Materials', ...nodes);
  return doc;
}

/**
 * Five animations: a spinning box, a bouncing sphere, morph targets, a skinned arm, and a clip
 * that moves nothing.
 */
function animated() {
  const doc = newDocument();
  const material = doc.createMaterial('Clay').setBaseColorFactor([0.8, 0.75, 0.7, 1]);
  const times = (values) => accessor(doc, 'SCALAR', new Float32Array(values));
  const animate = (name, node, path, input, output, type) => {
    const sampler = doc
      .createAnimationSampler()
      .setInput(times(input))
      .setOutput(accessor(doc, type, new Float32Array(output)))
      .setInterpolation('LINEAR');
    const channel = doc
      .createAnimationChannel()
      .setTargetNode(node)
      .setTargetPath(path)
      .setSampler(sampler);
    doc.createAnimation(name).addSampler(sampler).addChannel(channel);
  };

  const spinner = doc
    .createNode('Spinner')
    .setMesh(mesh(doc, 'Box', boxGeometry(0.8), material))
    .setTranslation([-2, 0.4, 0]);
  const quarterTurns = [0, 1, 2, 3, 4].flatMap((i) => quaternionY((i * Math.PI) / 2));
  animate('Spin', spinner, 'rotation', [0, 0.5, 1, 1.5, 2], quarterTurns, 'VEC4');

  const bouncer = doc
    .createNode('Bouncer')
    .setMesh(mesh(doc, 'Ball', sphereGeometry(0.3), material))
    .setTranslation([-0.7, 0.3, 0]);
  animate(
    'Bounce',
    bouncer,
    'translation',
    [0, 0.5, 1],
    [-0.7, 0.3, 0, -0.7, 1.3, 0, -0.7, 0.3, 0],
    'VEC3',
  );

  // Morph targets: "Raise" lifts the top face, "Widen" pushes the sides out.
  const box = boxGeometry(0.8);
  const raise = [];
  const widen = [];
  for (let i = 0; i < box.positions.length; i += 3) {
    raise.push(0, box.positions[i + 1] > 0 ? 0.6 : 0, 0);
    widen.push(Math.sign(box.positions[i]) * 0.3, 0, 0);
  }
  const morphMesh = mesh(doc, 'Morph Box', box, material).setWeights([0, 0]);
  morphMesh
    .listPrimitives()[0]
    .addTarget(
      doc
        .createPrimitiveTarget('Raise')
        .setAttribute('POSITION', accessor(doc, 'VEC3', new Float32Array(raise))),
    )
    .addTarget(
      doc
        .createPrimitiveTarget('Widen')
        .setAttribute('POSITION', accessor(doc, 'VEC3', new Float32Array(widen))),
    );
  const morph = doc.createNode('Morph').setMesh(morphMesh).setTranslation([0.7, 0.4, 0]);
  animate('Morph', morph, 'weights', [0, 1, 2], [0, 0, 1, 0, 0, 1], 'SCALAR');

  // A two-bone arm: a strip that bends at the elbow, one metre up.
  const positions = [];
  const normals = [];
  const joints = [];
  const weights = [];
  const indices = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const y = (i / steps) * 2;
    for (const x of [-0.1, 0.1]) {
      positions.push(x, y, 0);
      normals.push(0, 0, 1);
      // Below the elbow the shoulder alone moves a vertex, above it the elbow; they blend between.
      // Slots with no weight point at joint 0, as the spec asks.
      const upper = Math.min(1, Math.max(0, (y - 0.75) / 0.5));
      if (upper === 0 || upper === 1) {
        joints.push(upper, 0, 0, 0);
        weights.push(1, 0, 0, 0);
      } else {
        joints.push(0, 1, 0, 0);
        weights.push(1 - upper, upper, 0, 0);
      }
    }
    if (i < steps) indices.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
  }
  const arm = doc.createMesh('Arm').addPrimitive(
    doc
      .createPrimitive()
      .setAttribute('POSITION', accessor(doc, 'VEC3', new Float32Array(positions)))
      .setAttribute('NORMAL', accessor(doc, 'VEC3', new Float32Array(normals)))
      .setAttribute('JOINTS_0', accessor(doc, 'VEC4', new Uint8Array(joints)))
      .setAttribute('WEIGHTS_0', accessor(doc, 'VEC4', new Float32Array(weights)))
      .setIndices(accessor(doc, 'SCALAR', new Uint16Array(indices)))
      .setMaterial(material),
  );
  const shoulder = doc.createNode('Shoulder').setTranslation([2, 0, 0]);
  const elbow = doc.createNode('Elbow').setTranslation([0, 1, 0]);
  shoulder.addChild(elbow);
  const inverseBind = new Float32Array([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -2, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -2, -1, 0,
    1,
  ]);
  const skin = doc
    .createSkin('Arm Skin')
    .addJoint(shoulder)
    .addJoint(elbow)
    .setSkeleton(shoulder)
    .setInverseBindMatrices(accessor(doc, 'MAT4', inverseBind));
  const armNode = doc.createNode('Arm').setMesh(arm).setSkin(skin);
  animate(
    'Wave',
    elbow,
    'rotation',
    [0, 1, 2],
    [...quaternionZ(0), ...quaternionZ(-1.2), ...quaternionZ(0)],
    'VEC4',
  );
  // As some exporters write it: every key is the rest pose, so playing it moves nothing.
  animate('Still', elbow, 'rotation', [0, 1], [...quaternionZ(0), ...quaternionZ(0)], 'VEC4');

  scene(doc, 'Animated', spinner, bouncer, morph, shoulder, armNode);
  return doc;
}

/** One sphere whose material can be switched between three variants. */
function variants() {
  const doc = newDocument();
  const extension = doc.createExtension(KHRMaterialsVariants);
  const colors = { Red: [0.8, 0.1, 0.1, 1], Green: [0.1, 0.7, 0.2, 1], Blue: [0.1, 0.3, 0.9, 1] };
  const sphere = mesh(doc, 'Sphere', sphereGeometry(0.5));
  const mappings = extension.createMappingList();
  for (const [name, color] of Object.entries(colors)) {
    const material = doc.createMaterial(name).setBaseColorFactor(color);
    if (name === 'Red') sphere.listPrimitives()[0].setMaterial(material);
    mappings.addMapping(
      extension.createMapping().addVariant(extension.createVariant(name)).setMaterial(material),
    );
  }
  sphere.listPrimitives()[0].setExtension('KHR_materials_variants', mappings);
  scene(doc, 'Variants', doc.createNode('Sphere').setMesh(sphere).setTranslation([0, 0.5, 0]));
  return doc;
}

/** A finely divided sphere, the input of the compressed variants. */
function dense() {
  const doc = newDocument();
  const material = doc.createMaterial('Clay').setBaseColorFactor([0.8, 0.75, 0.7, 1]);
  scene(
    doc,
    'Dense',
    doc
      .createNode('Sphere')
      .setMesh(mesh(doc, 'Sphere', sphereGeometry(0.5, 64, 32), material))
      .setTranslation([0, 0.5, 0]),
  );
  return doc;
}

/** A textured box whose buffer and textures are separate files next to the .gltf. */
function textured() {
  const doc = newDocument();
  const material = doc
    .createMaterial('Checker')
    .setBaseColorTexture(texture(doc, 'checker', checker()));
  doc.getRoot().listBuffers()[0].setURI('textured.bin');
  scene(
    doc,
    'Textured',
    doc
      .createNode('Box')
      .setMesh(mesh(doc, 'Box', boxGeometry(1), material))
      .setTranslation([0, 0.5, 0]),
  );
  return doc;
}

/**
 * A box, and beside it another inside a node that KHR_node_visibility hides (added to the JSON,
 * which glTF Transform doesn't know).
 */
function hidden() {
  const doc = newDocument();
  doc.getRoot().listBuffers()[0].setURI('hidden.bin');
  const box = (name) => mesh(doc, name, boxGeometry(1));
  scene(
    doc,
    'Hidden',
    doc.createNode('Shown').setMesh(box('Shown')).setTranslation([0, 0.5, 0]),
    doc
      .createNode('Hidden')
      .setTranslation([10, 0.5, 0])
      .addChild(doc.createNode('Inside Hidden').setMesh(box('Inside Hidden'))),
  );
  return doc;
}

/** Two boxes with KTX2 textures: ETC1S on the left, UASTC on the right. */
async function compressedTextures() {
  const doc = newDocument();
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  const box = async (name, x, pixel, options) => {
    const image = await ktx2(64, 64, pixel, options);
    const material = doc
      .createMaterial(name)
      .setBaseColorTexture(doc.createTexture(name).setImage(image).setMimeType('image/ktx2'));
    return doc
      .createNode(name)
      .setMesh(mesh(doc, name, boxGeometry(1), material))
      .setTranslation([x, 0.5, 0]);
  };
  scene(
    doc,
    'Compressed textures',
    await box('ETC1S', -0.75, squares()),
    await box('UASTC', 0.75, squares([220, 110, 40, 255]), { uastc: true }),
  );
  return doc;
}

// OBJ, STL and PLY

/** Numbers in text formats: six decimals at most, without trailing zeros. */
const num = (value) => String(Number(value.toFixed(6)));
const line = (...words) =>
  words.map((word) => (typeof word === 'number' ? num(word) : word)).join(' ');
const text = (lines) => Buffer.from(`${lines.join('\n')}\n`);

/** Triangles of a box from `min` to `max`, wound outward, as STL lists facets: 12 of them. */
function boxFacets([x0, y0, z0], [x1, y1, z1]) {
  const corners = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  // Each side as a quad, counterclockwise seen from outside, with its normal.
  const sides = [
    [
      [0, 3, 2, 1],
      [0, 0, -1],
    ],
    [
      [4, 5, 6, 7],
      [0, 0, 1],
    ],
    [
      [0, 1, 5, 4],
      [0, -1, 0],
    ],
    [
      [2, 3, 7, 6],
      [0, 1, 0],
    ],
    [
      [1, 2, 6, 5],
      [1, 0, 0],
    ],
    [
      [0, 4, 7, 3],
      [-1, 0, 0],
    ],
  ];
  return sides.flatMap(([[a, b, c, d], normal]) => [
    { normal, corners: [corners[a], corners[b], corners[c]] },
    { normal, corners: [corners[a], corners[c], corners[d]] },
  ]);
}

/** A bracket in millimetres with Z up, as CAD writes STL: a base plate and an upright. */
const bracket = () => [...boxFacets([0, 0, 0], [40, 20, 5]), ...boxFacets([0, 0, 5], [6, 20, 25])];

/** A binary STL: an 80-byte header, the facet count, then 50 bytes a facet. */
function binaryStl(header, facets, attribute = () => 0) {
  const bytes = Buffer.alloc(84 + facets.length * 50);
  (typeof header === 'string' ? Buffer.from(header.padEnd(80, ' '), 'latin1') : header).copy(bytes);
  bytes.writeUInt32LE(facets.length, 80);
  facets.forEach(({ normal, corners }, index) => {
    const at = 84 + index * 50;
    [...normal, ...corners.flat()].forEach((value, i) => bytes.writeFloatLE(value, at + i * 4));
    bytes.writeUInt16LE(attribute(index), at + 48);
  });
  return bytes;
}

function asciiStl(solids) {
  const lines = [];
  for (const [name, facets] of solids) {
    lines.push(`solid ${name}`);
    for (const { normal, corners } of facets) {
      lines.push(`  facet normal ${line(...normal)}`, '    outer loop');
      for (const corner of corners) lines.push(`      vertex ${line(...corner)}`);
      lines.push('    endloop', '  endfacet');
    }
    lines.push(`endsolid ${name}`);
  }
  return text(lines);
}

/** A box of two materials, a ground plane and an outline, in metres with Y up. */
function cubeObj() {
  return text([
    `# ${GENERATOR}`,
    '# A box of two materials on a ground plane, with its top edges as lines.',
    'mtllib cube.mtl',
    'o Box',
    ...[
      [-0.5, 0, 0.5],
      [0.5, 0, 0.5],
      [0.5, 1, 0.5],
      [-0.5, 1, 0.5],
      [-0.5, 0, -0.5],
      [0.5, 0, -0.5],
      [0.5, 1, -0.5],
      [-0.5, 1, -0.5],
    ].map((v) => line('v', ...v)),
    ...[
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].map((vt) => line('vt', ...vt)),
    ...[
      [0, 0, 1],
      [0, 0, -1],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
    ].map((vn) => line('vn', ...vn)),
    's off',
    'usemtl Checker',
    'f 1/1/1 2/2/1 3/3/1 4/4/1',
    'f 4/1/5 3/2/5 7/3/5 8/4/5',
    'usemtl Painted',
    'f 6/1/2 5/2/2 8/3/2 7/4/2',
    'f 2/1/3 6/2/3 7/3/3 3/4/3',
    'f 5/1/4 1/2/4 4/3/4 8/4/4',
    'f 5/1/6 6/2/6 2/3/6 1/4/6',
    'o Ground',
    ...[
      [-1.5, -0.01, 1.5],
      [1.5, -0.01, 1.5],
      [1.5, -0.01, -1.5],
      [-1.5, -0.01, -1.5],
    ].map((v) => line('v', ...v)),
    'usemtl Grass',
    'f 9/1/5 10/2/5 11/3/5 12/4/5',
    'o Outline',
    'l 4 3 7 8 4',
  ]);
}

const cubeMtl = () =>
  text([
    `# ${GENERATOR}`,
    'newmtl Checker',
    'Kd 0.8 0.8 0.8',
    'Ns 250',
    'map_Kd checker.png',
    '',
    'newmtl Painted',
    'Kd 0.9 0.35 0.2',
    'Ns 100',
    '',
    'newmtl Grass',
    'Kd 0.3 0.6 0.25',
    'Ns 10',
  ]);

/** A pyramid in groups, with negative indices, a quad, vertex colors and no normals. */
const pyramidObj = () =>
  text([
    '# Negative indices, polygons, groups and vertex colors, without normals or texture coordinates.',
    'g Base',
    line('v', -1, 0, -1, 0.9, 0.2, 0.2),
    line('v', 1, 0, -1, 0.2, 0.9, 0.2),
    line('v', 1, 0, 1, 0.2, 0.2, 0.9),
    line('v', -1, 0, 1, 0.9, 0.9, 0.2),
    'f -1 -2 -3 -4',
    'g Sides',
    line('v', 0, 1.5, 0, 1, 1, 1),
    'f 1 5 2',
    'f 2 5 3',
    'f 3 5 4',
    'f 4 5 1',
  ]);

/**
 * A cylinder without normals in smoothing groups: the side in group 1 draws round, the top in
 * group 2 and the bottom with smoothing off draw flat, with sharp rims.
 */
function smoothObj() {
  const segments = 16;
  const lines = [
    `# ${GENERATOR}`,
    '# A cylinder without normals: side in smoothing group 1, top in group 2, bottom off.',
    'o Cylinder',
  ];
  for (const y of [0, 2]) {
    for (let i = 0; i < segments; i++) {
      const angle = (2 * Math.PI * i) / segments;
      lines.push(line('v', Math.cos(angle), y, Math.sin(angle)));
    }
  }
  const bottom = (i) => (i % segments) + 1;
  const top = (i) => (i % segments) + 1 + segments;
  lines.push('s 1');
  for (let i = 0; i < segments; i++) {
    lines.push(line('f', bottom(i), top(i), top(i + 1), bottom(i + 1)));
  }
  lines.push('s 2');
  lines.push(line('f', ...Array.from({ length: segments }, (_, i) => top(segments - i))));
  lines.push('s off');
  lines.push(line('f', ...Array.from({ length: segments }, (_, i) => bottom(i))));
  return text(lines);
}

/** Vertices alone, with colors: a point cloud as scanners write it in OBJ. */
function pointsObj() {
  const lines = [`# ${GENERATOR}`, '# A point cloud: vertices that no face uses.'];
  for (let i = 0; i < 400; i++) {
    const angle = i * 0.25;
    const radius = 0.2 + i / 400;
    lines.push(
      line(
        'v',
        Math.cos(angle) * radius,
        i / 200,
        Math.sin(angle) * radius,
        i / 400,
        0.4,
        1 - i / 400,
      ),
    );
  }
  return text(lines);
}

/** An OBJ with what goes wrong in real files: see `problems.mtl`. */
const problemsObj = () =>
  text([
    `# ${GENERATOR}`,
    'mtllib problems.mtl',
    'o Panel',
    line('v', 0, 0, 0),
    line('v', 1, 0, 0),
    line('v', 1, 1, 0),
    line('v', 0, 1, 0),
    line('vt', 0, 0),
    line('vt', 1, 0),
    line('vt', 1, 1),
    line('vt', 0, 1),
    'usemtl Textured',
    'f 1/1 2/2 3/3 4/4',
    '# A face naming a vertex the file lacks.',
    'f 1 2 99',
    'usemtl Undefined',
    'f 1 3 4',
    '# A free-form curve, which is valid OBJ but not drawn.',
    'cstype bspline',
    'deg 2',
    'curv 0 1 1 2 3',
    'end',
  ]);

/**
 * A texture by an absolute Windows path, found by its name next to the model; one that isn't
 * there; one in a format browsers can't show.
 */
const problemsMtl = () =>
  text([
    'newmtl Textured',
    'Kd 1 1 1',
    'map_Kd C:\\Users\\artist\\textures\\checker.png',
    'map_Bump -bm 0.5 bumps.tga',
    'map_Ke stone.tga',
  ]);

/** A 2 × 2 uncompressed TGA, an image format browsers don't show. */
function tga() {
  const bytes = Buffer.alloc(18 + 2 * 2 * 3);
  bytes[2] = 2;
  bytes.writeUInt16LE(2, 12);
  bytes.writeUInt16LE(2, 14);
  bytes[16] = 24;
  bytes.fill(128, 18);
  return bytes;
}

/** What a compiler's object file starts with: binary, not an OBJ model. */
function objectFile() {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt16LE(0x8664, 0);
  bytes.writeUInt16LE(2, 2);
  bytes.write('.text', 20, 'latin1');
  return bytes;
}

/** An octahedron: six vertices with colors and normals, eight faces. */
const OCTAHEDRON = {
  vertices: [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ],
  colors: [
    [230, 60, 50],
    [60, 200, 90],
    [250, 220, 70],
    [40, 90, 220],
    [240, 240, 240],
    [30, 30, 30],
  ],
  faces: [
    [0, 2, 4],
    [4, 2, 1],
    [1, 2, 5],
    [5, 2, 0],
    [4, 3, 0],
    [1, 3, 4],
    [5, 3, 1],
    [0, 3, 5],
  ],
};

function octahedronPly() {
  const { vertices, colors, faces } = OCTAHEDRON;
  return text([
    'ply',
    'format ascii 1.0',
    `comment ${GENERATOR}`,
    'obj_info An octahedron with vertex colors and normals',
    `element vertex ${vertices.length}`,
    'property float x',
    'property float y',
    'property float z',
    'property float nx',
    'property float ny',
    'property float nz',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    `element face ${faces.length}`,
    'property list uchar int vertex_indices',
    'end_header',
    ...vertices.map((v, i) => line(...v, ...v, ...colors[i])),
    ...faces.map((face) => line(face.length, ...face)),
  ]);
}

/** The bracket's box corners as a PLY mesh of quads, in either byte order. */
function bracketPly(littleEndian) {
  const boxes = [
    [
      [0, 0, 0],
      [40, 20, 5],
    ],
    [
      [0, 0, 5],
      [6, 20, 25],
    ],
  ];
  const vertices = [];
  const faces = [];
  for (const [[x0, y0, z0], [x1, y1, z1]] of boxes) {
    const base = vertices.length;
    vertices.push(
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0],
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    );
    for (const quad of [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [2, 3, 7, 6],
      [1, 2, 6, 5],
      [0, 4, 7, 3],
    ]) {
      faces.push(quad.map((corner) => base + corner));
    }
  }
  const header = text([
    'ply',
    `format ${littleEndian ? 'binary_little_endian' : 'binary_big_endian'} 1.0`,
    `comment ${GENERATOR}`,
    `element vertex ${vertices.length}`,
    'property double x',
    'property double y',
    'property double z',
    'property ushort red',
    'property ushort green',
    'property ushort blue',
    'property ushort alpha',
    `element face ${faces.length}`,
    'property list uchar int vertex_indices',
    'end_header',
  ]);
  const body = Buffer.alloc(vertices.length * 32 + faces.length * 17);
  let at = 0;
  const write = (method, value, size) => {
    body[`${method}${littleEndian ? 'LE' : 'BE'}`](value, at);
    at += size;
  };
  vertices.forEach(([x, y, z], i) => {
    for (const value of [x, y, z]) write('writeDouble', value, 8);
    // A shade of blue rising with the height, opaque.
    for (const value of [8000 + i * 2000, 20000 + i * 3000, 60000, 65535]) {
      write('writeUInt16', value, 2);
    }
  });
  for (const face of faces) {
    body[at++] = face.length;
    for (const index of face) write('writeInt32', index, 4);
  }
  return Buffer.concat([header, body]);
}

/**
 * Points with colors at UTM-like coordinates hundreds of kilometres from the origin, as a
 * scanner writes them in doubles; one without coordinates (NaN); a camera element to pass over.
 */
function cloudPly() {
  const count = 600;
  const header = text([
    'ply',
    'format binary_little_endian 1.0',
    `comment ${GENERATOR}`,
    'comment Georeferenced points, as a terrestrial scanner writes them',
    `element vertex ${count + 1}`,
    'property double x',
    'property double y',
    'property double z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'element camera 1',
    'property float view_px',
    'property float view_py',
    'property float view_pz',
    'end_header',
  ]);
  const body = Buffer.alloc((count + 1) * 27 + 12);
  let at = 0;
  for (let i = 0; i <= count; i++) {
    const angle = i * 0.13;
    const [x, y, z] =
      i === 300
        ? [Number.NaN, Number.NaN, Number.NaN]
        : [
            500000.25 + Math.cos(angle) * (2 + i / 100),
            4100000.5 + Math.sin(angle) * (2 + i / 100),
            100 + i / 60,
          ];
    for (const value of [x, y, z]) {
      body.writeDoubleLE(value, at);
      at += 8;
    }
    body[at++] = Math.round(80 + (i / count) * 170);
    body[at++] = 140;
    body[at++] = Math.round(250 - (i / count) * 170);
  }
  for (const value of [500000, 4100000, 120]) {
    body.writeFloatLE(value, at);
    at += 4;
  }
  return Buffer.concat([header, body]);
}

/** A textured quad as MeshLab writes it: the texture in a comment, coordinates per corner. */
const texturedPly = () =>
  text([
    'ply',
    'format ascii 1.0',
    `comment ${GENERATOR}`,
    'comment TextureFile checker.png',
    'element vertex 4',
    'property float x',
    'property float y',
    'property float z',
    'element face 2',
    'property list uchar int vertex_indices',
    'property list uchar float texcoord',
    'end_header',
    line(0, 0, 0),
    line(1, 0, 0),
    line(1, 1, 0),
    line(0, 1, 0),
    line(3, 0, 1, 2, 6, 0, 0, 1, 0, 1, 1),
    line(3, 0, 2, 3, 6, 0, 0, 1, 1, 0, 1),
  ]);

// Writing

/** A GLB container: 12-byte header, then a JSON chunk padded with spaces and a BIN chunk. */
function glb(json, bin) {
  const pad4 = (length) => (length + 3) & ~3;
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.alloc(pad4(jsonBytes.length), 0x20);
  jsonBytes.copy(jsonChunk);
  const binChunk = Buffer.alloc(pad4(bin.length));
  Buffer.from(bin).copy(binChunk);
  const chunkHeader = (length, type) => {
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32LE(length, 0);
    bytes.write(type, 4, 'ascii');
    return bytes;
  };
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  return Buffer.concat([
    header,
    chunkHeader(jsonChunk.length, 'JSON'),
    jsonChunk,
    chunkHeader(binChunk.length, 'BIN\0'),
    binChunk,
  ]);
}

function write(name, bytes) {
  const path = join(OUT, name);
  writeFileSync(path, bytes);
  console.log(`wrote ${path} (${bytes.length} bytes)`);
  return bytes;
}

const writeGlb = async (name, doc) => write(name, Buffer.from(await io.writeBinary(doc)));

/** A .gltf with its resources as separate files, named by their URIs; `edit` changes the JSON. */
async function writeGltf(name, doc, edit = () => {}) {
  const { json, resources } = await io.writeJSON(doc, {
    format: Format.GLTF,
    basename: name.replace(/\.gltf$/, ''),
  });
  edit(json);
  write(name, Buffer.from(`${JSON.stringify(json, null, 2)}\n`));
  for (const [uri, bytes] of Object.entries(resources)) write(uri, Buffer.from(bytes));
  return json;
}

/** The triangle as .gltf JSON with its one buffer pointing at `uri`. */
async function triangleWithBuffer(uri) {
  const { json, resources } = await io.writeJSON(triangle(), {
    format: Format.GLTF,
    basename: 'triangle',
  });
  const bytes = Object.values(resources)[0];
  json.buffers[0].uri =
    uri ?? `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`;
  return `${JSON.stringify(json, null, 2)}\n`;
}

mkdirSync(OUT, { recursive: true });

// Models that open.
const triangleGlb = await writeGlb('triangle.glb', triangle());
await writeGltf('triangle.gltf', triangle());
const sceneGlb = await writeGlb('scene.glb', sceneModel());
await writeGlb('scene-edited.glb', sceneModel({ edited: true }));
await writeGlb('materials.glb', materials());
await writeGlb('instanced.glb', instanced());
await writeGlb('animated.glb', animated());
await writeGlb('variants.glb', variants());
// Many exporters leave out the type of an image given by URI, which glTF allows.
await writeGltf('textured.gltf', textured(), (json) => {
  for (const image of json.images) delete image.mimeType;
});
write('embedded.gltf', Buffer.from(await triangleWithBuffer()));
await writeGltf('hidden.gltf', hidden(), (json) => {
  const node = json.nodes.find((each) => each.name === 'Hidden');
  node.extensions = { KHR_node_visibility: { visible: false } };
  json.extensionsUsed = ['KHR_node_visibility'];
  json.extensionsRequired = ['KHR_node_visibility'];
});

// The same dense sphere, stored three ways.
await writeGlb('dense.glb', dense());
await writeGlb('draco.glb', await dense().transform(draco({ method: 'edgebreaker' })));
await writeGlb(
  'meshopt.glb',
  await dense().transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' })),
);
await writeGlb('quantized.glb', await dense().transform(quantize()));
await writeGlb('ktx2.glb', await compressedTextures());

// Files that can't be shown, or only partly.
write('empty.glb', Buffer.alloc(0));
write('not-a-model.glb', Buffer.from('This is not a glTF model.\n'));
// The header and JSON are whole but the binary chunk stops halfway: the structure can still show.
const jsonLength = sceneGlb.readUInt32LE(12);
const binLength = sceneGlb.readUInt32LE(20 + jsonLength);
write('truncated.glb', sceneGlb.subarray(0, 20 + jsonLength + 8 + Math.floor(binLength / 2)));
write(
  'lfs-pointer.glb',
  Buffer.from(
    `version https://git-lfs.github.com/spec/v1\noid sha256:${createHash('sha256').update(triangleGlb).digest('hex')}\nsize ${triangleGlb.length}\n`,
  ),
);
{
  const { json, resources } = await io.writeJSON(triangle(), { format: Format.GLB });
  json.extensionsUsed = ['EXT_nightmesh_unknown'];
  json.extensionsRequired = ['EXT_nightmesh_unknown'];
  write('unsupported-extension.glb', glb(json, resources['@glb.bin']));
}
write('missing-resource.gltf', Buffer.from(await triangleWithBuffer('missing.bin')));
write(
  'network-resource.gltf',
  Buffer.from(await triangleWithBuffer('https://example.com/triangle.bin')),
);
write('outside-folder.gltf', Buffer.from(await triangleWithBuffer('../outside/triangle.bin')));
write('absolute-path.gltf', Buffer.from(await triangleWithBuffer('/models/triangle.bin')));

// OBJ, STL and PLY models that open.
write('cube.obj', cubeObj());
write('cube.mtl', cubeMtl());
write('pyramid.obj', pyramidObj());
write('smooth.obj', smoothObj());
write('points.obj', pointsObj());
// Binary, with a header that starts like ASCII STL, as SolidWorks writes it.
const bracketStl = write(
  'bracket.stl',
  binaryStl('solid bracket, in millimetres with Z up', bracket()),
);
write(
  'solids.stl',
  asciiStl([
    ['base', boxFacets([0, 0, 0], [30, 30, 4])],
    ['peg', boxFacets([12, 12, 4], [18, 18, 20])],
  ]),
);
{
  // Materialise Magics: a default color in the header, and facets with colors of their own.
  const header = Buffer.alloc(80, 0x20);
  header.write('Nightmesh fixture COLOR=', 0, 'latin1');
  header.set([200, 200, 210, 255], 24);
  write(
    'colored.stl',
    binaryStl(header, bracket(), (index) => (index < 12 ? 0x8000 : 31 | (10 << 5) | (2 << 10))),
  );
}
write('octahedron.ply', octahedronPly());
write('bracket.ply', bracketPly(true));
write('bracket-be.ply', bracketPly(false));
write('cloud.ply', cloudPly());
write('textured.ply', texturedPly());

// OBJ, STL and PLY files that can't be shown, or only partly.
write('problems.obj', problemsObj());
write('problems.mtl', problemsMtl());
write('stone.tga', tga());
write(
  'missing-library.obj',
  text(['mtllib nowhere.mtl', 'usemtl Something', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3']),
);
// Names in Latin-1, as older exporters write them in the system's code page.
const latin1 = (lines) => Buffer.from(`${lines.join('\n')}\n`, 'latin1');
write('latin1.mtl', latin1([`# ${GENERATOR}`, 'newmtl Terraindæk', 'Kd 0.2 0.6 0.2']));
write(
  'latin1.obj',
  latin1(['mtllib latin1.mtl', 'usemtl Terraindæk', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3']),
);
// A library of one material that the file never selects: its faces are in it.
write('only-material.mtl', text([`# ${GENERATOR}`, 'newmtl Clay', 'Kd 0.8 0.5 0.3']));
write(
  'only-material.obj',
  text(['mtllib only-material.mtl', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3']),
);
// The comment Maya writes at the top of every OBJ file it exports, naming the unit.
write(
  'maya.obj',
  text([
    `# ${GENERATOR}`,
    '# This file uses centimeters as units for non-parametric coordinates.',
    'v 0 0 0',
    'v 20 0 0',
    'v 20 30 0',
    'v 0 30 0',
    'f 1 2 3 4',
  ]),
);
// UTF-16 with its byte order mark, as Windows tools can write text.
write(
  'utf16.obj',
  Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(`# ${GENERATOR}\r\nv 0 0 0\r\nv 1 0 0\r\nv 0 1 0\r\nf 1 2 3\r\n`, 'utf16le'),
  ]),
);
// Triangle strips, as VCG writes them, after a header comment without its keyword.
write(
  'strips.ply',
  text([
    'ply',
    'format ascii 1.0',
    `comment ${GENERATOR}`,
    'Created by an exporter that left out the comment keyword',
    'element vertex 6',
    'property float x',
    'property float y',
    'property float z',
    'element tristrips 1',
    'property list int int vertex_indices',
    'end_header',
    '0 0 0',
    '0 1 0',
    '1 0 0',
    '1 1 0',
    '2 0 0',
    '2 1 0',
    // Two strips of two triangles each, parted by -1.
    '9 0 1 2 3 -1 2 3 4 5',
  ]),
);
write('object-file.obj', objectFile());
write('not-a-model.stl', Buffer.from('This is not an STL model.\n'));
write('truncated.stl', bracketStl.subarray(0, 84 + 50 * 10 + 20));
write('not-a-model.ply', text(['ply', 'format unknown 1.0', 'end_header']));

if (LARGE) {
  mkdirSync(join(OUT, 'generated'), { recursive: true });
  const doc = newDocument();
  const material = doc.createMaterial('Clay').setBaseColorFactor([0.8, 0.75, 0.7, 1]);
  scene(
    doc,
    'Large',
    doc.createNode('Grid').setMesh(mesh(doc, 'Grid', gridGeometry(1024), material)),
  );
  await writeGlb('generated/large.glb', doc);
}
