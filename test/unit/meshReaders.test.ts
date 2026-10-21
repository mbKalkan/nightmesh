import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MeshFormatError,
  type MeshObject,
  type MeshPart,
  type ParsedMesh,
} from '../../src/extension/model/mesh/geometry';
import { libraryNames } from '../../src/extension/model/mesh/obj';
import { parseMtl, textureFile } from '../../src/extension/model/mesh/mtl';
import { createReader, headerFacts, looksLike } from '../../src/extension/model/mesh/parse';
import type { MeshFormat } from '../../src/shared/protocol';

const FIXTURES = 'test/fixtures';
const file = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

/** Reads a fixture in pieces of `size` bytes, as the extension reads in larger ones. */
function read(name: string, size = 1 << 20): ParsedMesh {
  const bytes = file(name);
  const format = name.slice(name.lastIndexOf('.') + 1) as MeshFormat;
  const reader = createReader(format, bytes.length);
  for (let at = 0; at < bytes.length; at += size) reader.push(bytes.slice(at, at + size));
  return reader.finish();
}

const parts = (objects: MeshObject[]): MeshPart[] =>
  objects.flatMap((object) => [...object.parts, ...parts(object.children)]);
const triangles = (part: MeshPart) => (part.indices?.length ?? part.positions.length / 3) / 3;
const vertices = (part: MeshPart) => part.positions.length / 3;
/** An sRGB byte as a linear 16-bit channel. */
const linear = (byte: number) => Math.round(((byte / 255 + 0.055) / 1.055) ** 2.4 * 65535);

describe('STL', () => {
  it('welds the vertices of a binary file, even one whose header starts with "solid"', () => {
    const mesh = read('bracket.stl');
    const [part] = parts(mesh.objects);
    expect(mesh.facts).toEqual({
      format: 'stl',
      encoding: 'binary',
      header: 'solid bracket, in millimetres with Z up',
      triangles: 24,
    });
    expect(triangles(part)).toBe(24);
    // Two boxes, eight corners each, two corners shared.
    expect(vertices(part)).toBe(14);
    expect(part.normals).toBeUndefined();
    expect(mesh.problems).toEqual([]);
  });

  it('reads each solid of an ASCII file as an object of its own', () => {
    const mesh = read('solids.stl', 7);
    expect(mesh.objects.map((object) => object.name)).toEqual(['base', 'peg']);
    expect(mesh.objects.map((object) => vertices(object.parts[0]))).toEqual([8, 8]);
    expect(mesh.facts).toMatchObject({ encoding: 'ascii', solids: ['base', 'peg'], triangles: 24 });
  });

  it("keeps Materialise's facet colors, without welding", () => {
    const mesh = read('colored.stl');
    const [part] = parts(mesh.objects);
    expect(mesh.facts).toMatchObject({ colors: true });
    expect(part.indices).toBeUndefined();
    expect(vertices(part)).toBe(72);
    const color = (vertex: number) => [...part.colors!.subarray(vertex * 4, vertex * 4 + 4)];
    // The header's default (200, 200, 210), then a facet's own: five bits a channel.
    expect(color(0)).toEqual([linear(200), linear(200), linear(210), 65535]);
    expect(color(36)).toEqual([65535, linear(82), linear(16), 65535]);
  });

  it('reads what a cut-off file has, and says so', () => {
    const mesh = read('truncated.stl');
    expect(triangles(parts(mesh.objects)[0])).toBe(10);
    expect(mesh.problems).toEqual([{ kind: 'truncated' }]);
  });

  it('tells binary from ASCII, and both from other files', () => {
    expect(looksLike('stl', file('bracket.stl'), file('bracket.stl').length)).toBe('yes');
    expect(looksLike('stl', file('solids.stl'), file('solids.stl').length)).toBe('yes');
    expect(looksLike('stl', file('not-a-model.stl'), file('not-a-model.stl').length)).toBe('no');
    expect(() => read('not-a-model.stl')).toThrow(MeshFormatError);
    expect(headerFacts('stl', file('bracket.stl'), file('bracket.stl').length)).toEqual({
      format: 'stl',
      encoding: 'binary',
      triangles: 24,
    });
  });
});

describe('PLY', () => {
  it('reads ASCII vertices with normals and colors, and faces', () => {
    const mesh = read('octahedron.ply', 5);
    const [part] = parts(mesh.objects);
    expect(part.mode).toBe('triangles');
    expect(vertices(part)).toBe(6);
    expect(triangles(part)).toBe(8);
    expect([...part.normals!.subarray(0, 3)]).toEqual([1, 0, 0]);
    // sRGB 230 as linear, in 16 bits.
    expect(part.colors![0]).toBe(linear(230));
    expect(part.alpha).toBeUndefined();
    expect(mesh.facts).toMatchObject({
      format: 'ply',
      encoding: 'ascii',
      version: '1.0',
      objInfo: ['An octahedron with vertex colors and normals'],
      elements: [
        { name: 'vertex', count: 6, properties: expect.arrayContaining(['float x', 'uchar red']) },
        { name: 'face', count: 8, properties: ['list uchar int vertex_indices'] },
      ],
    });
  });

  it('reads binary files of either byte order alike, quads as triangles', () => {
    const little = parts(read('bracket.ply', 3).objects)[0];
    const big = parts(read('bracket-be.ply', 3).objects)[0];
    expect(vertices(little)).toBe(16);
    expect(triangles(little)).toBe(24);
    expect(little.alpha).toBe(true);
    expect(big.positions).toEqual(little.positions);
    expect(big.colors).toEqual(little.colors);
    expect(big.indices).toEqual(little.indices);
  });

  it('draws a file without faces as points, leaving out those without coordinates', () => {
    const mesh = read('cloud.ply', 1000);
    const [part] = parts(mesh.objects);
    expect(part.mode).toBe('points');
    expect(vertices(part)).toBe(600);
    // Kept close to 0 in floats, the distance in the node: the file's own coordinates.
    expect(mesh.offset).toEqual([500002, 4100001, 100]);
    expect(Math.abs(part.positions[0])).toBeLessThan(1);
    expect(part.positions.every(Number.isFinite)).toBe(true);
    expect(mesh.facts).toMatchObject({
      encoding: 'binary_little_endian',
      elements: [
        { name: 'vertex', count: 601 },
        { name: 'camera', count: 1 },
      ],
    });
  });

  it("gives each corner of MeshLab's textured faces its own texture coordinates", () => {
    const mesh = read('textured.ply');
    const [part] = parts(mesh.objects);
    expect(mesh.materials).toEqual([{ name: 'checker.png', texture: 'checker.png' }]);
    expect(part.material).toBe(0);
    expect(vertices(part)).toBe(4);
    expect([...part.uvs!]).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
  });

  it('reads triangle strips, and a header comment without its keyword', () => {
    const mesh = read('strips.ply', 7);
    const [part] = parts(mesh.objects);
    // Every other triangle of a strip turned back, so all face the same way.
    expect([...part.indices!]).toEqual([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5]);
    expect(mesh.facts).toMatchObject({
      comments: [
        'Nightmesh fixture generator',
        'Created by an exporter that left out the comment keyword',
      ],
    });
  });

  it("turns down what isn't PLY", () => {
    expect(looksLike('ply', file('not-a-model.ply'), 34)).toBe('yes');
    expect(() => read('not-a-model.ply')).toThrow(MeshFormatError);
    expect(looksLike('ply', file('not-a-model.stl'), 26)).toBe('no');
    expect(headerFacts('ply', file('cloud.ply'), file('cloud.ply').length)).toMatchObject({
      comments: [
        'Nightmesh fixture generator',
        'Georeferenced points, as a terrestrial scanner writes them',
      ],
    });
  });
});

describe('OBJ', () => {
  it('makes a node of each object, a part of each material, from distinct corners', () => {
    const mesh = read('cube.obj', 11);
    expect(mesh.objects.map((object) => object.name)).toEqual(['Box', 'Ground', 'Outline']);
    expect(mesh.materials.map((material) => material.name)).toEqual([
      'Checker',
      'Painted',
      'Grass',
    ]);
    expect(mesh.libraries).toEqual(['cube.mtl']);
    const [checker, painted] = mesh.objects[0].parts;
    expect([checker.material, vertices(checker), triangles(checker)]).toEqual([0, 8, 4]);
    expect([painted.material, vertices(painted), triangles(painted)]).toEqual([1, 16, 8]);
    expect(checker.normals).toHaveLength(24);
    // V turned for glTF: OBJ's (0, 0) is the bottom left of the image.
    expect([...checker.uvs!.subarray(0, 2)]).toEqual([0, 1]);
    const outline = mesh.objects[2].parts[0];
    expect([outline.mode, outline.indices?.length]).toEqual(['lines', 8]);
    expect(mesh.facts).toMatchObject({
      statements: { v: 12, vt: 4, vn: 6, f: 7, o: 3, usemtl: 3, mtllib: 1, l: 1, s: 1 },
      comments: [
        'Nightmesh fixture generator',
        'A box of two materials on a ground plane, with its top edges as lines.',
      ],
    });
  });

  it('follows negative indices into groups, with vertex colors and no normals', () => {
    const mesh = read('pyramid.obj');
    expect(mesh.objects.map((object) => object.name)).toEqual(['Base', 'Sides']);
    const [base] = mesh.objects[0].parts;
    expect(triangles(base)).toBe(2);
    expect(base.normals).toBeUndefined();
    expect(base.colors).toHaveLength(16);
    expect(triangles(mesh.objects[1].parts[0])).toBe(4);
  });

  it('draws vertices that no face uses as a point cloud', () => {
    const [part] = parts(read('points.obj').objects);
    expect([part.mode, vertices(part), part.colors?.length]).toEqual(['points', 400, 1600]);
  });

  it('leaves out faces naming missing vertices, and counts what it does not draw', () => {
    const mesh = read('problems.obj');
    expect(mesh.problems).toEqual([
      { kind: 'faces', count: 1 },
      { kind: 'freeForm', count: 1 },
    ]);
    expect(mesh.facts).toMatchObject({ statements: { curv: 1, cstype: 1, deg: 1, end: 1 } });
  });

  it("knows a compiler's object file from a model", () => {
    expect(looksLike('obj', file('object-file.obj'), 64)).toBe('objectFile');
    expect(looksLike('obj', file('cube.obj'), 100)).toBe('yes');
    expect(looksLike('obj', file('utf16.obj'), 100)).toBe('yes');
  });

  it('reads UTF-16 text, and UTF-8 after a byte order mark', () => {
    const utf16 = read('utf16.obj', 5);
    expect(triangles(parts(utf16.objects)[0])).toBe(1);
    expect(utf16.facts).toMatchObject({ comments: ['Nightmesh fixture generator'] });
    const reader = createReader('obj', 100);
    const marked = ['\ufeff# Marked', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3', ''].join('\n');
    reader.push(new TextEncoder().encode(marked));
    expect(reader.finish().facts).toMatchObject({
      comments: ['Marked'],
      statements: { v: 3, f: 1 },
    });
  });

  it('reads one library name with spaces, or several', () => {
    expect(libraryNames('my model.mtl')).toEqual(['my model.mtl']);
    expect(libraryNames('a.mtl  b.mtl')).toEqual(['a.mtl', 'b.mtl']);
    expect(libraryNames('')).toEqual([]);
  });
});

describe('MTL', () => {
  it('keeps every statement, and what becomes the glTF material', () => {
    const [checker, painted] = parseMtl(file('cube.mtl'));
    expect(checker).toMatchObject({
      name: 'Checker',
      diffuse: [0.8, 0.8, 0.8],
      shininess: 250,
      maps: { diffuse: 'checker.png' },
    });
    expect(checker.statements).toEqual([
      ['Kd', '0.8 0.8 0.8'],
      ['Ns', '250'],
      ['map_Kd', 'checker.png'],
    ]);
    expect(painted.maps).toEqual({});
  });

  it('finds the file after the options of a texture statement', () => {
    expect(textureFile('-bm 0.5 bumps.tga')).toBe('bumps.tga');
    expect(textureFile('-s 2 2 1 -o 0.5 0.5 -clamp on my texture.png')).toBe('my texture.png');
    expect(textureFile('-mm 0 1 -imfchan l wood.jpg')).toBe('wood.jpg');
    expect(textureFile('')).toBeUndefined();
  });
});
