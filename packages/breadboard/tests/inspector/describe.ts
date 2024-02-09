/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from "ava";

import { inspectableGraph } from "../../src/inspector/index.js";
import { GraphDescriptor } from "../../src/types.js";

import { loadToInspect } from "../../src/inspector/index.js";

const BASE_URL = new URL("../../../tests/inspector/data/", import.meta.url);

const load = async (url: string) => {
  const base = BASE_URL;
  const loader = loadToInspect(base);
  return loader(url, { nodes: [], edges: [] });
};

test("simple graph description works as expected", async (t) => {
  const graph = {
    nodes: [
      { id: "a", type: "input" },
      { id: "b", type: "bar" },
      { id: "c", type: "output" },
    ],
    edges: [
      { from: "a", to: "b", in: "foo", out: "text" },
      { from: "b", to: "c", in: "text", out: "bar" },
    ],
  } satisfies GraphDescriptor;
  const inspectable = inspectableGraph(graph);
  const api = await inspectable.describe();
  t.deepEqual(api, {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: {
          type: "string",
        },
      },
      required: ["text"],
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: {
          type: "string",
        },
      },
      required: ["text"],
    },
  });
});

test("inspector API can describe the input in simplest.json", async (t) => {
  const simplest = await load("simplest.json");
  if (!simplest) {
    return t.fail("Graph is undefined");
  }
  const input = simplest.nodesByType("input")[0];

  const api = await input.describe();

  t.deepEqual(api, {
    inputSchema: {
      type: "object",
      properties: {
        text: {
          description: "The prompt to generate a completion for",
          examples: ["Tell me a fun story about playing with breadboards"],
          title: "Prompt",
          type: "string",
        },
      },
      required: ["text"],
    },
    outputSchema: {
      type: "object",
      properties: {
        text: {
          description: "The prompt to generate a completion for",
          examples: ["Tell me a fun story about playing with breadboards"],
          title: "Prompt",
          type: "string",
        },
      },
      required: ["text"],
    },
  });
});

test("inspector API can describe the input in simplest-no-schema.json", async (t) => {
  const simplest = await load("simplest-no-schema.json");
  if (!simplest) {
    return t.fail("Graph is undefined");
  }
  const input = simplest.nodesByType("input")[0];

  const api = await input.describe();

  t.deepEqual(api, {
    inputSchema: {
      type: "object",
      additionalProperties: true,
    },
    outputSchema: {
      type: "object",
      additionalProperties: true,
    },
  });
});

test("inspector API can describe the input in simplest-no-schema-strict.json", async (t) => {
  const simplest = await load("simplest-no-schema-strict.json");
  if (!simplest) {
    return t.fail("Graph is undefined");
  }
  const input = simplest.nodesByType("input")[0];

  const api = await input.describe();

  t.deepEqual(api, {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: {
          type: "string",
        },
      },
      required: ["text"],
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: {
          type: "string",
        },
      },
      required: ["text"],
    },
  });
});

test("inspector API can describe the output in simplest.json", async (t) => {
  const simplest = await load("simplest.json");
  if (!simplest) {
    return t.fail("Graph is undefined");
  }
  const output = simplest.nodesByType("output")[0];

  const api = await output.describe();

  t.deepEqual(api, {
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          title: "Response",
          description: "The completion generated by the LLM",
        },
      },
      required: ["text"],
    },
    outputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          title: "Response",
          description: "The completion generated by the LLM",
        },
      },
      required: ["text"],
    },
  });
});

test("inspector API can describe the output in simplest-no-schema.json", async (t) => {
  const simplest = await load("simplest-no-schema.json");
  if (!simplest) {
    return t.fail("Graph is undefined");
  }
  const output = simplest.nodesByType("output")[0];

  const api = await output.describe();

  t.deepEqual(api, {
    inputSchema: {
      type: "object",
      additionalProperties: true,
    },
    outputSchema: {
      type: "object",
      additionalProperties: true,
    },
  });
});

test("inspector API can describe the output in simplest-no-schema-strict.json", async (t) => {
  const simplest = await load("simplest-no-schema-strict.json");
  if (!simplest) {
    return t.fail("Graph is undefined");
  }
  const output = simplest.nodesByType("output")[0];

  const api = await output.describe();

  t.deepEqual(api, {
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: {
          type: "string",
        },
      },
      required: ["text"],
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: {
          type: "string",
        },
      },
      required: ["text"],
    },
  });
});