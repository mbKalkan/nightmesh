import { AnimationClip, Group, NumberKeyframeTrack, Object3D, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { Playback } from '../../src/webview/scene/playback';

/** A root with one child, and two clips: one moves the child along X, one along Y. */
function scene() {
  const root = new Group();
  const child = new Object3D();
  child.name = 'Child';
  child.position.set(1, 2, 3);
  root.add(child);
  const clips = [
    new AnimationClip('AlongX', 2, [
      new VectorKeyframeTrack('Child.position', [0, 2], [0, 0, 0, 10, 0, 0]),
    ]),
    new AnimationClip('AlongY', 1, [
      new VectorKeyframeTrack('Child.position', [0, 1], [0, 0, 0, 0, 10, 0]),
      new NumberKeyframeTrack('Child.visible', [0], [1]),
    ]),
  ];
  return { root, child, playback: new Playback(root, clips) };
}

describe('Playback', () => {
  it('poses the model at any time of a clip', () => {
    const { child, playback } = scene();
    playback.select(0);
    expect(playback.duration).toBe(2);
    playback.seek(1);
    expect(child.position.x).toBeCloseTo(5);
    playback.seek(99);
    expect(playback.time).toBe(2);
  });

  it('plays at the speed asked, looping, and only when playing', () => {
    const { child, playback } = scene();
    playback.select(0);
    playback.advance(1);
    expect(child.position.x).toBe(0);
    playback.setPlaying(true);
    playback.speed = 2;
    playback.advance(0.5);
    expect(child.position.x).toBeCloseTo(5);
    // Two and a half seconds into a two-second clip: it loops rather than stops at the end.
    playback.advance(0.75);
    expect(playback.time).toBeCloseTo(0.5);
  });

  it('puts the model back as the file has it before another clip plays', () => {
    const { child, playback } = scene();
    playback.select(0, 1);
    expect(child.position.toArray()).toEqual([5, 0, 0]);
    playback.select(1);
    expect(child.position.toArray()).toEqual([0, 0, 0]);
    playback.select(0, 0.5);
    expect(child.position.x).toBeCloseTo(2.5);
  });

  it('never plays a clip that has no length', () => {
    const root = new Group();
    const playback = new Playback(root, [new AnimationClip('Empty', 0, [])]);
    playback.select(0);
    playback.setPlaying(true);
    expect(playback.playing).toBe(false);
  });
});
