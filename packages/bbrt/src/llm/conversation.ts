/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Signal } from "signal-polyfill";
import { SignalArray } from "signal-utils/array";
import type { SignalSet } from "signal-utils/set";
import type { SecretsProvider } from "../secrets/secrets-provider.js";
import type { BBRTTool, InvokeResult, ToolInvocation } from "../tools/tool.js";
import { BufferedMultiplexStream } from "../util/buffered-multiplex-stream.js";
import { Lock } from "../util/lock.js";
import type { Result } from "../util/result.js";
import { waitForState } from "../util/wait-for-state.js";
import type { BBRTChunk } from "./chunk.js";
import {
  bbrtTurnsToGeminiContents,
  gemini,
  simplifyJsonSchemaForGemini,
  type GeminiFunctionDeclaration,
  type GeminiParameterSchema,
  type GeminiRequest,
} from "./gemini.js";
import type { BBRTModel } from "./model.js";
import {
  bbrtTurnsToOpenAiMessages,
  openai,
  type OpenAIChatRequest,
  type OpenAITool,
} from "./openai.js";

// TODO(aomarks) Consider making this whole thing a SignalObject.
export type BBRTTurn = BBRTUserTurn | BBRTModelTurn | BBRTErrorTurn;

export type BBRTUserTurn = BBRTUserTurnContent | BBRTUserTurnToolResponses;

export type BBRTTurnStatus =
  | "pending"
  | "streaming"
  | "using-tools"
  | "done"
  | "error";

export interface BBRTUserTurnContent {
  kind: "user-content";
  role: "user";
  status: Signal.State<BBRTTurnStatus>;
  content: string;
}

export interface BBRTUserTurnToolResponses {
  kind: "user-tool-responses";
  role: "user";
  status: Signal.State<BBRTTurnStatus>;
  responses: BBRTToolResponse[];
}

export interface BBRTModelTurn {
  kind: "model";
  role: "model";
  status: Signal.State<BBRTTurnStatus>;
  content: AsyncIterable<string>;
  toolCalls?: SignalArray<BBRTToolCall>;
  error?: unknown;
}

export interface BBRTErrorTurn {
  kind: "error";
  role: "user" | "model";
  status: Signal.State<BBRTTurnStatus>;
  error: unknown;
}

export interface BBRTToolCall {
  id: string;
  tool: BBRTTool;
  args: unknown;
  invocation: ToolInvocation;
}

export interface BBRTToolResponse {
  id: string;
  tool: BBRTTool;
  invocation: ToolInvocation;
  args: unknown;
  response: InvokeResult;
}

export class BBRTConversation {
  readonly turns = new SignalArray<BBRTTurn>();
  readonly #lock = new Lock();
  readonly #model: Signal.State<BBRTModel>;
  readonly #tools: SignalSet<BBRTTool>;
  readonly #secrets: SecretsProvider;

  constructor(
    model: Signal.State<BBRTModel>,
    tools: SignalSet<BBRTTool>,
    secrets: SecretsProvider
  ) {
    this.#model = model;
    this.#tools = tools;
    this.#secrets = secrets;
  }

  send(message: { content: string }): Promise<void> {
    // Serialize all requests with a lock. Note that a single call to #send can
    // generate many turns, because of tool calls.
    return this.#lock.do(() => this.#send(message));
  }

  async #send(
    message: { content: string } | { toolResponses: BBRTToolResponse[] }
  ): Promise<void> {
    // TODO(aomarks) We read this.#model and this.#tools across async boundaries
    // in this function, plus we recurse. We should have frozen copies of those
    // instead, and use them throughout. What's a good pattern for this problem
    // in general? Should we be factoring out a Sender class so that we can
    // replace it wholesale whenever the other two change, maybe with a computed
    // signal?

    // Create the user turn. (Note we only support sending either content or
    // tool responses in one message, not both).
    if ("toolResponses" in message) {
      this.turns.push({
        kind: "user-tool-responses",
        role: "user",
        status: new Signal.State<BBRTTurnStatus>("done"),
        responses: message.toolResponses,
      });
    } else {
      this.turns.push({
        kind: "user-content",
        role: "user",
        status: new Signal.State<BBRTTurnStatus>("done"),
        content: message.content,
      });
    }

    // Create the model turn (in anticipation).
    const status = new Signal.State<BBRTTurnStatus>("pending");
    const toolCalls = new SignalArray<BBRTToolCall>();
    const contentStream = new TransformStream<string, string>();
    const modelTurn: BBRTModelTurn = {
      kind: "model",
      role: "model",
      status,
      // Use BufferedMultiplexStream so that we can have as many consumers as
      // needed of the entire content stream.
      content: new BufferedMultiplexStream(contentStream.readable),
      toolCalls,
    };
    this.turns.push(modelTurn);

    const modelResponse = await this.#generate();
    if (!modelResponse.ok) {
      status.set("error");
      modelTurn.error = modelResponse.error;
      // TODO(aomarks) Use a new "using" statement for this, with broad scope.
      // Same for lock.
      void contentStream.writable.close();
      // TODO(aomarks) Hack because we don't yet render the error for a model
      // turn whose state is error. Can probably delete the error kind all
      // together.
      this.turns.push({
        kind: "error",
        role: "model",
        status,
        error: modelResponse.error,
      });
      return;
    }

    const contentWriter = contentStream.writable.getWriter();
    const toolResponsePromises: Array<Promise<Result<BBRTToolResponse>>> = [];
    for await (const chunk of modelResponse.value) {
      status.set("streaming");
      switch (chunk.kind) {
        case "append-content": {
          await contentWriter.write(chunk.content);
          break;
        }
        case "tool-call": {
          // TODO(aomarks) tools should be a Map, not a Set (throughout). Though
          // we should preserve order, so maybe it should be some other data
          // structure really.
          const tool = await (async () => {
            for (const tool of this.#tools) {
              if (tool.metadata.id === chunk.name) {
                return tool;
              }
            }
            return undefined;
          })();
          if (tool === undefined) {
            console.error("unknown tool", JSON.stringify(chunk));
            this.turns.push({
              kind: "error",
              role: "model",
              status,
              error: new Error(`Unknown tool: ${JSON.stringify(chunk)}`),
            });
            break;
          }
          const invocation = tool.invoke(chunk.arguments);
          toolCalls.push({
            id: chunk.id,
            args: chunk.arguments,
            tool,
            invocation,
          });
          toolResponsePromises.push(
            this.#monitorInvocation(chunk.id, tool, chunk.arguments, invocation)
          );
          break;
        }
        default: {
          chunk satisfies never;
          console.error("unknown chunk kind:", chunk);
          break;
        }
      }
    }
    await contentWriter.close();
    if (toolResponsePromises.length === 0) {
      status.set("done");
    } else {
      status.set("using-tools");
      const toolResponses = await Promise.all(toolResponsePromises);
      const errors = toolResponses
        .filter((response) => !response.ok)
        .map((response) => response.error);
      if (errors.length > 0) {
        status.set("error");
        const error =
          errors.length === 1 ? errors[0] : new AggregateError(errors);
        modelTurn.error = error;
        // TODO(aomarks) Remove once we render errors directly on turns. Though,
        // be careful here, since if we add retry, we don't want to retry the
        // whole turn, just the model call. Maybe we need a turn role for tool
        // invocations?
        this.turns.push({
          kind: "error",
          role: "model",
          status,
          error,
        });
      } else {
        status.set("done");
        return this.#send({
          toolResponses: toolResponses.map((r) => r.value!),
        });
      }
    }
  }

  // TODO(aomarks) Kinda ugly. Should be simpler?
  async #monitorInvocation(
    id: string,
    tool: BBRTTool,
    args: unknown,
    invocation: ToolInvocation
  ): Promise<Result<BBRTToolResponse>> {
    const result = await waitForState(
      invocation.state,
      (state) => state.status === "success" || state.status === "error"
    );
    if (result.status === "success") {
      return {
        ok: true,
        value: {
          id,
          tool,
          invocation,
          args,
          response: result.value,
        },
      };
    } else if (result.status === "error") {
      return { ok: false, error: result.error };
    } else {
      throw new Error("Internal error");
    }
  }

  async #generate(): Promise<Result<AsyncIterableIterator<BBRTChunk>>> {
    let chunks;
    const model = this.#model.get();
    // TODO(aomarks) Factor thesse out into classes that are configured on main,
    // rather than hard-coding here.
    if (model === "gemini") {
      chunks = await this.#generateGemini();
    } else if (model === "openai") {
      chunks = await this.#generateOpenai();
    } else {
      throw new Error(`Unknown model: ${model}`);
    }
    if (!chunks.ok) {
      return chunks;
    }
    return { ok: true, value: chunks.value };
  }

  async #generateGemini(): Promise<Result<AsyncIterableIterator<BBRTChunk>>> {
    const contents = await bbrtTurnsToGeminiContents(onlyDoneTurns(this.turns));
    const request: GeminiRequest = {
      contents,
    };
    if (this.#tools.size > 0) {
      // TODO(aomarks) 1 tool with N functions works, but N tools with 1
      // function each produces a 400 error. By design?
      request.tools = [
        {
          functionDeclarations: await Promise.all(
            [...this.#tools].map(async (tool) => {
              const inputSchema = (await tool.api()).value?.inputSchema;
              const fn: GeminiFunctionDeclaration = {
                name: tool.metadata.id,
                description: tool.metadata.description,
                parameters: inputSchema as GeminiParameterSchema,
              };
              if (inputSchema !== undefined) {
                fn.parameters = simplifyJsonSchemaForGemini(inputSchema);
              }
              return fn;
            })
          ),
        },
      ];
    }
    const apiKey = await this.#secrets.getSecret("GEMINI_API_KEY");
    if (!apiKey.ok) {
      return apiKey;
    }
    if (apiKey.value === undefined) {
      return { ok: false, error: new Error("Missing GEMINI_API_KEY") };
    }
    return gemini(request, apiKey.value);
  }

  async #generateOpenai(): Promise<Result<AsyncIterableIterator<BBRTChunk>>> {
    const messages = await bbrtTurnsToOpenAiMessages(onlyDoneTurns(this.turns));
    const request: OpenAIChatRequest = {
      model: "gpt-4o",
      messages,
    };
    if (this.#tools.size > 0) {
      const tools = await Promise.all(
        [...this.#tools].map(async (tool) => {
          const { id, description } = tool.metadata;
          const api = await tool.api();
          if (!api.ok) {
            return api;
          }
          const { inputSchema } = api.value;
          return {
            ok: true,
            value: {
              type: "function",
              function: {
                name: id,
                description,
                parameters: inputSchema,
              },
            } satisfies OpenAITool,
          };
        })
      );
      request.tools = [];
      for (const tool of tools) {
        if (tool.ok) {
          request.tools.push(tool.value);
        } else {
          // TODO(aomarks): handle error
        }
      }
    }
    const apiKey = await this.#secrets.getSecret("OPENAI_API_KEY");
    if (!apiKey.ok) {
      return apiKey;
    }
    if (apiKey.value === undefined) {
      return { ok: false, error: new Error("Missing OPENAI_API_KEY") };
    }
    return openai(request, apiKey.value);
  }
}

function onlyDoneTurns(turns: Array<BBRTTurn>): BBRTTurn[] {
  return turns.filter((turn) => turn.status.get() === "done");
}
