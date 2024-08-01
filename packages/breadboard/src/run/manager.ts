/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LifecycleManager } from "./lifecycle.js";
import { Reanimator } from "./reanimator.js";
import type {
  ManagedRunState,
  ReanimationController,
  ReanimationInputs,
  ReanimationState,
} from "./types.js";

export class RunStateManager implements ManagedRunState {
  #lifecycle: LifecycleManager;
  #inputs?: ReanimationInputs;
  #resumeFrom: ReanimationState;

  constructor(resumeFrom: ReanimationState, inputs?: ReanimationInputs) {
    this.#resumeFrom = resumeFrom;
    this.#lifecycle = new LifecycleManager([]);
    this.#inputs = inputs;
  }

  lifecycle() {
    // TODO: Lifecycle during reanimation should be doing
    // nothing, since we're reconstructing the state of
    // the run from a previously saved state.
    return this.#lifecycle;
  }

  reanimation(): ReanimationController {
    return new Reanimator(this.#resumeFrom, this.#inputs);
  }
}
