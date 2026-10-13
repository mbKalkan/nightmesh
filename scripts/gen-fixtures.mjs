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
  KHRLightsPunctual,
  KHRMaterialsClearcoat,
  KHRMaterialsEmissiveStrength,
  KHRMaterialsIOR,
  KHRMaterialsTransmission,
  KHRMaterialsUnlit,
  KHRMaterialsVariants,
  KHRTextureTransform,
  Light,
} from '@gltf-transform/extensions';
import { draco, meshopt, quantize } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
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

const checker = () =>
  png(64, 64, (x, y) =>
    ((x >> 3) + (y >> 3)) % 2 === 0 ? [235, 235, 235, 255] : [52, 120, 220, 255],
  );

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
function sceneModel() {
  const doc = newDocument();
  const material = doc
    .createMaterial('Clay')
    .setBaseColorFactor([0.8, 0.75, 0.7, 1])
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
  root.addChild(doc.createNode('Box').setMesh(box).setTranslation([-1.5, 0.5, 0]));
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
  group.addChild(doc.createNode('Points').setMesh(cloud).setTranslation([0, 0.5, 0]));
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

/** Four animations: a spinning box, a bouncing sphere, morph targets and a skinned arm. */
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

/** A .gltf with its resources as separate files, named by their URIs. */
async function writeGltf(name, doc) {
  const { json, resources } = await io.writeJSON(doc, {
    format: Format.GLTF,
    basename: name.replace(/\.gltf$/, ''),
  });
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
await writeGlb('materials.glb', materials());
await writeGlb('animated.glb', animated());
await writeGlb('variants.glb', variants());
await writeGltf('textured.gltf', textured());
write('embedded.gltf', Buffer.from(await triangleWithBuffer()));

// The same dense sphere, stored three ways.
await writeGlb('dense.glb', dense());
await writeGlb('draco.glb', await dense().transform(draco({ method: 'edgebreaker' })));
await writeGlb(
  'meshopt.glb',
  await dense().transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' })),
);
await writeGlb('quantized.glb', await dense().transform(quantize()));

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
