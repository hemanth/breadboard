/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type SnapshotUpdaterArgs<Value> = {
  initial(): Value;
  latest(): Promise<Value>;
  willUpdate(previous: Value, current: Value): void;
};

type Snapshot<Value> = {
  current: Value;
  latest: Promise<Value>;
};

export { SnapshotUpdater };

class SnapshotUpdater<Value> {
  #current: Value | null = null;
  #snapshot: Promise<Value> | null = null;

  constructor(public readonly args: SnapshotUpdaterArgs<Value>) {}

  refresh() {
    this.#snapshot = null;
    this.latest().catch(() => {
      // eat the errors to remove any weird side effects of calling `refresh`.
    });
  }

  snapshot(): Snapshot<Value> {
    return { current: this.current(), latest: this.latest() };
  }

  current(): Value {
    if (!this.#current) {
      this.#current = this.args.initial();
      this.refresh();
    }
    return this.#current;
  }

  async latest(): Promise<Value> {
    if (this.#snapshot) {
      return this.#snapshot;
    }

    this.#snapshot = this.args.latest().then((latest) => {
      this.args.willUpdate(this.current(), latest);
      this.#current = latest;
      return latest;
    });

    return this.#snapshot;
  }
}
