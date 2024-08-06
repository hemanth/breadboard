/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GraphDescriptor } from "@google-labs/breadboard-schema/graph.js";
import { deepStrictEqual, ok } from "node:assert";
import test, { describe } from "node:test";
import { LocalRunner } from "../../../src/harness/local-runner.js";
import { HarnessRunner } from "../../../src/harness/types.js";
import { createLoader } from "../../../src/loader/index.js";
import { OutputResponse } from "../../../src/types.js";
import { testKit } from "../test-kit.js";

import multiLevelInvoke from "../../bgl/multi-level-invoke.bgl.json" with { type: "json" };
import simple from "../../bgl/simple.bgl.json" with { type: "json" };
import askForSecret from "../../bgl/ask-for-secret.bgl.json" with { type: "json" };

const BGL_DIR = new URL("../../../tests/bgl/test.bgl.json", import.meta.url)
  .href;

type EventLogEntry = [name: string, data: unknown];

const eventNamesFromLog = (log: EventLogEntry[]) => log.map(([name]) => name);
const queryLog = (log: EventLogEntry[], name: string) =>
  log.find(([n]) => n == name)?.[1];

const logEvents = (runner: HarnessRunner, events: EventLogEntry[]) => {
  const eventNames = [
    "start",
    "pause",
    "resume",
    "input",
    "output",
    "secret",
    "error",
    "skip",
    "graphstart",
    "graphend",
    "nodestart",
    "nodeend",
    "end",
  ];
  eventNames.forEach((name) => {
    runner.addEventListener(name, (event) => {
      const e = event as unknown as { data: unknown };
      events.push([name, e.data]);
    });
  });
};

describe("LocalRunner", async () => {
  test("simple graph with no diagnostics", async () => {
    const events: EventLogEntry[] = [];
    const runner = new LocalRunner({
      runner: simple as GraphDescriptor,
      url: import.meta.url,
      loader: createLoader(),
      kits: [testKit],
    });
    logEvents(runner, events);
    {
      const result = await runner.run();
      ok(result == false);
      ok(!runner.running());
      deepStrictEqual(eventNamesFromLog(events), ["start", "input", "pause"]);
    }
    {
      const result = await runner.run({ text: "foo" });
      ok(result == true);
      ok(!runner.running());
      deepStrictEqual(eventNamesFromLog(events), [
        "start",
        "input",
        "pause",
        "resume",
        "output",
        "end",
      ]);
      const output = queryLog(events, "output") as OutputResponse;
      deepStrictEqual(output.outputs, { text: "foo" });
    }
  });

  test("simple graph with diagnostics", async () => {
    const events: [name: string, data: unknown][] = [];
    const runner = new LocalRunner({
      runner: simple as GraphDescriptor,
      url: import.meta.url,
      loader: createLoader(),
      kits: [testKit],
      diagnostics: true,
    });
    logEvents(runner, events);
    {
      const result = await runner.run();
      ok(result == false);
      ok(!runner.running());
      deepStrictEqual(eventNamesFromLog(events), [
        "start",
        "graphstart",
        "nodestart",
        "input",
        "pause",
      ]);
    }
    {
      const result = await runner.run({ text: "foo" });
      ok(result == true);
      ok(!runner.running());
      deepStrictEqual(eventNamesFromLog(events), [
        "start",
        "graphstart",
        "nodestart",
        "input",
        "pause",
        "resume",
        "nodeend",
        "nodestart",
        "output",
        "nodeend",
        "graphend",
        "end",
      ]);
      const output = queryLog(events, "output") as OutputResponse;
      deepStrictEqual(output.outputs, { text: "foo" });
    }
  });

  test("multi-level invoke graph with diagnostics", async () => {
    const events: EventLogEntry[] = [];
    const graph = multiLevelInvoke as GraphDescriptor;
    graph.url = BGL_DIR;
    const runner = new LocalRunner({
      runner: multiLevelInvoke as GraphDescriptor,
      url: import.meta.url,
      loader: createLoader(),
      kits: [testKit],
      diagnostics: true,
    });
    logEvents(runner, events);
    {
      const result = await runner.run();
      ok(!result);
      ok(!runner.running());
      deepStrictEqual(eventNamesFromLog(events), [
        "start",
        "graphstart",
        "nodestart",
        "graphstart",
        "nodestart",
        "input",
        "pause",
      ]);
    }
    {
      events.length = 0;
      const result = await runner.run({ name: "Bob" });
      ok(!result);
      ok(!runner.running());
      deepStrictEqual(eventNamesFromLog(events), [
        "resume",
        "nodeend",
        "nodestart",
        "graphstart",
        "nodestart",
        "input",
        "pause",
      ]);
    }
    {
      events.length = 0;
      const result = await runner.run({ location: "Neptune" });
      ok(result);
      ok(!runner.running());
      deepStrictEqual(eventNamesFromLog(events), [
        "resume",
        "nodeend",
        "nodestart",
        "nodeend",
        "skip",
        "nodestart",
        "nodeend",
        "graphend",
        "nodeend",
        "nodestart",
        "nodeend",
        "nodestart",
        "nodeend",
        "graphend",
        "nodeend",
        "nodestart",
        "output",
        "nodeend",
        "graphend",
        "end",
      ]);
      const output = queryLog(events, "output") as OutputResponse;
      deepStrictEqual(output.outputs, {
        greeting: 'Greeting is: "Hello, Bob from Neptune!"',
      });
    }
  });

  test("local runner provides schema for pending inputs", async () => {
    const runner = new LocalRunner({
      runner: simple as GraphDescriptor,
      url: import.meta.url,
      loader: createLoader(),
      kits: [testKit],
    });
    const result = await runner.run();
    ok(!result);
    const schema = runner.inputSchema();
    deepStrictEqual(schema, {
      type: "object",
      properties: {
        text: { type: "string", title: "Text", examples: [] },
      },
      required: [],
    });
  });

  test("local runner correctly handles secret inputs", async () => {
    const events: EventLogEntry[] = [];
    const runner = new LocalRunner({
      runner: askForSecret as GraphDescriptor,
      url: import.meta.url,
      loader: createLoader(),
      kits: [testKit],
      diagnostics: true,
      interactiveSecrets: true,
    });
    logEvents(runner, events);
    {
      const result = await runner.run();
      ok(!result);
      ok(!runner.running());
      deepStrictEqual(eventNamesFromLog(events), [
        "start",
        "graphstart",
        "nodestart",
        "secret",
        "pause",
      ]);
    }
    {
      events.length = 0;
      deepStrictEqual(runner.secretKeys(), ["SECRET"]);
      const result = await runner.run({ SECRET: "foo" });
      ok(result);
      ok(!runner.running());
      deepStrictEqual(eventNamesFromLog(events), [
        "resume",
        "nodeend",
        "graphend",
        "end",
      ]);
    }
  });

  test("correctly calls the observer", async () => {
    const runner = new LocalRunner({
      runner: simple as GraphDescriptor,
      url: import.meta.url,
      loader: createLoader(),
      kits: [testKit],
    });
    let observed = false;
    runner.addObserver({
      runs() {
        throw new Error("Not implemented");
      },
      load() {
        throw new Error("Not implemented");
      },
      async observe() {
        observed = true;
      },
    });
    const result = await runner.run();
    ok(observed);
    ok(!result);
  });

  test("can handle observers that throw errors", async () => {
    const runner = new LocalRunner({
      runner: simple as GraphDescriptor,
      url: import.meta.url,
      loader: createLoader(),
      kits: [testKit],
    });
    runner.addObserver({
      runs() {
        throw new Error("Not implemented");
      },
      load() {
        throw new Error("Not implemented");
      },
      observe() {
        throw new Error("I'm an observer that throws an error");
      },
    });
    const result = await runner.run();
    ok(!result);
  });
});
