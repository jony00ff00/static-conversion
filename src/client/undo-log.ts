/**
 * One undo history across the Editor and Nodes tabs. Each tab keeps its own snapshots (the Editor's document
 * History, the graph store's zundo states); this log records which of them took each step, so Undo in either tab
 * undoes the latest step, wherever it was made.
 */
export type UndoSide = 'editor' | 'graph';

interface Side {
  undo(): void;
  redo(): void;
}

class UndoLog {
  private past: UndoSide[] = [];
  private future: UndoSide[] = [];
  private sides: Partial<Record<UndoSide, Side>> = {};
  /** Set while replaying a step, so the side's own bookkeeping isn't recorded as a new step. */
  private replaying = false;
  private listeners = new Set<() => void>();

  /** Start afresh (a project was opened). */
  reset() {
    this.past = [];
    this.future = [];
    this.notify();
  }

  register(side: UndoSide, handlers: Side) {
    this.sides[side] = handlers;
  }

  /** A side took a new step. */
  record(side: UndoSide) {
    if (this.replaying) return;
    this.past.push(side);
    if (this.past.length > 300) this.past.shift();
    this.future = [];
    this.notify();
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  undo() {
    const side = this.past.pop();
    if (!side) return;
    this.future.push(side);
    this.replay(() => this.sides[side]?.undo());
  }

  redo() {
    const side = this.future.pop();
    if (!side) return;
    this.past.push(side);
    this.replay(() => this.sides[side]?.redo());
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private replay(fn: () => void) {
    this.replaying = true;
    try {
      fn();
    } finally {
      this.replaying = false;
      this.notify();
    }
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }
}

export const undoLog = new UndoLog();
