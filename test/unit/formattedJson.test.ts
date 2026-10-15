import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FormattedJson } from '../../src/extension/model/formattedJson';
import { entryPointer } from '../../src/webview/structure/pointers';

/** A fixture's glTF JSON text, from a .gltf or the JSON chunk of a .glb. */
function fixture(name: string): string {
  const bytes = readFileSync(join('test/fixtures', name));
  return name.endsWith('.glb')
    ? bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')
    : bytes.toString('utf8');
}

describe('FormattedJson', () => {
  it('lays the JSON out as JSON.stringify does with two spaces', () => {
    for (const name of ['scene.glb', 'animated.glb', 'textured.gltf', 'variants.glb']) {
      const json = fixture(name);
      expect(new FormattedJson(json).text).toBe(`${JSON.stringify(JSON.parse(json), null, 2)}\n`);
    }
  });

  it('finds what a pointer names, or the nearest thing that holds it', () => {
    const json = fixture('scene.glb');
    const parsed = JSON.parse(json);
    const formatted = new FormattedJson(json);
    const at = (pointer: string) => {
      const { start, end } = formatted.rangeOf(pointer);
      return JSON.parse(formatted.text.slice(start, end));
    };
    expect(at('/nodes/1')).toEqual(parsed.nodes[1]);
    expect(at('/meshes/0/primitives/0/attributes')).toEqual(
      parsed.meshes[0].primitives[0].attributes,
    );
    // A single value, and something the model doesn't have, show what holds them.
    expect(at('/meshes/0/primitives/0/attributes/POSITION')).toEqual(
      parsed.meshes[0].primitives[0].attributes,
    );
    expect(at('/nodes/999')).toEqual(parsed.nodes);
    expect(at('/nothing/here')).toEqual(parsed);
  });

  it('names the place the cursor is in', () => {
    const formatted = new FormattedJson('{"a":[{"b":{"c/d~":[1,2]}}],"e":3}');
    const offset = (text: string) => formatted.text.indexOf(text);
    expect(formatted.pointerAt(0)).toBe('');
    expect(formatted.pointerAt(offset('"b"'))).toBe('/a/0');
    expect(formatted.pointerAt(offset('1'))).toBe('/a/0/b/c~1d~0');
    expect(formatted.pointerAt(offset('"e"'))).toBe('');
    expect(formatted.pointerAt(formatted.text.length)).toBe('');
    expect(formatted.rangeOf('/a/0/b/c~1d~0')).toEqual({
      start: offset('[\n          1'),
      end: offset(']\n      }') + 1,
    });
  });

  it('turns down text that is not JSON', () => {
    expect(() => new FormattedJson('{')).toThrow();
  });
});

describe('entryPointer', () => {
  it('points at an entry in the JSON', () => {
    expect(entryPointer('model')).toBe('');
    expect(entryPointer('node:12')).toBe('/nodes/12');
    expect(entryPointer('light:1')).toBe('/extensions/KHR_lights_punctual/lights/1');
    expect(entryPointer('group:meshes')).toBe('/meshes');
    expect(entryPointer('group:otherNodes')).toBe('/nodes');
    expect(entryPointer('primitive:1')).toBe('');
  });
});
