import * as vscode from 'vscode';
import type { CameraState, DiffSide, HostToWebviewMessage } from '../shared/protocol';
import { DIFF_LABEL_SEPARATOR, orderSides, type DiffCandidate } from './diffSides';

/** The two viewers of a comparison are created together; a lone one stops waiting after this. */
const PAIRING_WINDOW_MS = 5000;

export interface DiffMember {
  readonly uri: vscode.Uri;
  readonly post: (message: HostToWebviewMessage) => Thenable<boolean>;
  /** The webview has loaded and can receive messages. */
  ready: boolean;
  side?: DiffSide;
  peer?: DiffMember;
  /** Where its camera last was, for a peer that comes later. */
  camera?: CameraState;
}

interface Waiting {
  member: DiffMember;
  label: string;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Pairs up the two viewers of a comparison and relays what they share: where the camera is, so
 * both sides look at their model from the same place.
 *
 * VS Code compares files that have a custom editor by opening one editor per version side by
 * side, in a tab whose input the API doesn't expose and whose label reads "a.glb ↔ b.glb".
 * Viewers created while such a tab is active in their editor group belong to it.
 */
export class DiffPairs {
  private readonly waiting = new Map<vscode.ViewColumn, Waiting>();

  add(member: DiffMember, column: vscode.ViewColumn | undefined): void {
    if (column === undefined) return;
    const tab = vscode.window.tabGroups.all.find((group) => group.viewColumn === column)?.activeTab;
    if (!tab || tab.input !== undefined || !tab.label.includes(DIFF_LABEL_SEPARATOR)) return;

    const waiting = this.waiting.get(column);
    if (waiting) {
      clearTimeout(waiting.timer);
      this.waiting.delete(column);
    }
    if (waiting && waiting.label === tab.label) {
      const [original, modified] = orderSides(waiting.member, member, describe, tab.label);
      this.pair(original, modified);
    } else {
      const timer = setTimeout(() => this.waiting.delete(column), PAIRING_WINDOW_MS);
      this.waiting.set(column, { member, label: tab.label, timer });
    }
  }

  ready(member: DiffMember): void {
    member.ready = true;
    this.announce(member);
  }

  /** Passes a viewer's camera on to the other side. */
  camera(member: DiffMember, camera: CameraState): void {
    member.camera = camera;
    const { peer } = member;
    if (peer?.ready) void peer.post({ type: 'peerCamera', camera });
  }

  remove(member: DiffMember): void {
    for (const [column, waiting] of this.waiting) {
      if (waiting.member === member) {
        clearTimeout(waiting.timer);
        this.waiting.delete(column);
      }
    }
    const { peer } = member;
    member.peer = undefined;
    if (peer) {
      peer.peer = undefined;
      peer.side = undefined;
      if (peer.ready) void peer.post({ type: 'diff', side: undefined });
    }
  }

  private pair(original: DiffMember, modified: DiffMember): void {
    original.side = 'original';
    modified.side = 'modified';
    original.peer = modified;
    modified.peer = original;
    this.announce(original);
    this.announce(modified);
  }

  /** Tells a viewer its side once it can hear it, along with what its peer already shared. */
  private announce(member: DiffMember): void {
    if (!member.ready || !member.side) return;
    void member.post({ type: 'diff', side: member.side });
    const camera = member.peer?.camera;
    if (camera) void member.post({ type: 'peerCamera', camera });
  }
}

function describe({ uri }: DiffMember): DiffCandidate {
  return {
    name: uri.path.slice(uri.path.lastIndexOf('/') + 1),
    scheme: uri.scheme,
    gitRef: uri.scheme === 'git' ? gitRef(uri) : undefined,
  };
}

/** The version a URI from VS Code's Git extension points at, kept in its query as JSON. */
function gitRef(uri: vscode.Uri): string | undefined {
  try {
    const { ref } = JSON.parse(uri.query) as { ref?: unknown };
    return typeof ref === 'string' ? ref : undefined;
  } catch {
    return undefined;
  }
}
