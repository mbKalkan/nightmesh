import {
  AnimationMixer,
  LoopRepeat,
  type AnimationAction,
  type AnimationClip,
  type Mesh,
  type Object3D,
  type Quaternion,
  type Vector3,
} from 'three';

/** Where an object was before any animation moved it. */
interface Rest {
  object: Object3D;
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
  influences?: number[];
}

/**
 * Plays a model's animations, one clip at a time, looping. Switching clips first puts the model
 * back as the file has it, so what one clip moved doesn't stay moved in the next.
 */
export class Playback {
  private readonly mixer: AnimationMixer;
  private readonly rest: Rest[] = [];
  private action: AnimationAction | undefined;
  clip = -1;
  playing = false;
  speed = 1;

  constructor(
    private readonly root: Object3D,
    readonly clips: readonly AnimationClip[],
  ) {
    this.mixer = new AnimationMixer(root);
    root.traverse((object) => {
      const influences = (object as Partial<Mesh>).morphTargetInfluences;
      this.rest.push({
        object,
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
        influences: influences ? [...influences] : undefined,
      });
    });
  }

  get time(): number {
    return this.action?.time ?? 0;
  }

  get duration(): number {
    return this.clips[this.clip]?.duration ?? 0;
  }

  /** Makes clip `index` the one played, at `time`, paused or playing as before. */
  select(index: number, time = 0): void {
    if (index === this.clip && this.action) return this.seek(time);
    this.action?.stop();
    this.restore();
    this.clip = index;
    const clip = this.clips[index];
    this.action = clip ? this.mixer.clipAction(clip) : undefined;
    if (!this.action) return;
    this.action.setLoop(LoopRepeat, Infinity);
    this.action.play();
    this.action.paused = !this.playing;
    this.seek(time);
  }

  setPlaying(playing: boolean): void {
    this.playing = playing && this.duration > 0;
    if (this.action) this.action.paused = !this.playing;
  }

  /** Shows the pose at `time` seconds into the clip. */
  seek(time: number): void {
    if (!this.action) return;
    this.action.time = Math.max(0, Math.min(time, this.duration));
    this.mixer.update(0);
  }

  /** Moves the clip on by `seconds` of wall-clock time, at the playback speed. */
  advance(seconds: number): void {
    this.mixer.update(seconds * this.speed);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }

  private restore(): void {
    for (const { object, position, quaternion, scale, influences } of this.rest) {
      object.position.copy(position);
      object.quaternion.copy(quaternion);
      object.scale.copy(scale);
      const current = (object as Partial<Mesh>).morphTargetInfluences;
      if (current && influences) influences.forEach((value, i) => (current[i] = value));
    }
  }
}
