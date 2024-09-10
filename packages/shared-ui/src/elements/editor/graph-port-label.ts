/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  InspectablePort,
  isInlineData,
  isLLMContent,
  isLLMContentArray,
  isStoredData,
  isTextCapabilityPart,
  PortStatus,
} from "@google-labs/breadboard";
import * as PIXI from "pixi.js";
import { getGlobalColor, isConfigurablePort } from "./utils";
import { GRAPH_OPERATIONS } from "./types";

const hoverColor = getGlobalColor("--bb-ui-50");
const nodeTextColor = getGlobalColor("--bb-neutral-900");
const previewTextColor = getGlobalColor("--bb-neutral-500");

const PREVIEW_WIDTH = 170;

export class GraphPortLabel extends PIXI.Container {
  #isDirty = false;

  #width = 0;
  #height = 0;
  #textSize = 12;
  #portTextColor = nodeTextColor;
  #spacing = 4;
  #radius = 4;
  #paddingLeft = 4;
  #paddingTop = 4;
  #paddingBottom = 4;
  #paddingRight = 8;

  #previewTextSize = 12;
  #previewTextColor = previewTextColor;

  #port: InspectablePort | null = null;
  #label: PIXI.Text;
  #valuePreview: PIXI.HTMLText;
  #hoverZone = new PIXI.Graphics();

  #showNodePreviewValues = false;
  #isConfigurable = false;

  constructor(port: InspectablePort) {
    super();

    this.#label = new PIXI.Text({
      text: port.title,
      style: {
        fontFamily: "Arial",
        fontSize: this.#textSize,
        fill: this.#portTextColor,
        align: "left",
      },
    });

    this.#valuePreview = new PIXI.HTMLText({
      text: this.#createTruncatedValue(port),
      style: {
        fontFamily: "Arial",
        fontSize: this.#previewTextSize,
        tagStyles: {
          div: {
            fontStyle: "italic",
            lineHeight: this.#previewTextSize * 1.5,
          },
        },
        fill: this.#previewTextColor,
        align: "left",
        wordWrap: true,
        wordWrapWidth: PREVIEW_WIDTH,
        breakWords: false,
      },
    });

    this.#label.eventMode = "none";
    this.#valuePreview.eventMode = "none";

    this.addChild(this.#hoverZone);
    this.addChild(this.#label);
    this.addChild(this.#valuePreview);

    this.#hoverZone.visible = false;
    this.#valuePreview.visible = false;
    this.port = port;

    this.onRender = () => {
      if (!this.#isDirty) {
        return;
      }
      this.#isDirty = false;
      this.#positionElements();
      this.#draw();
    };

    this.addEventListener("pointerover", (evt: PIXI.FederatedPointerEvent) => {
      if (!this.isConfigurable) {
        return;
      }

      const ptrEvent = evt.nativeEvent as PointerEvent;
      const [top] = ptrEvent.composedPath();
      if (!(top instanceof HTMLElement)) {
        return;
      }

      if (top.tagName !== "CANVAS") {
        return;
      }

      this.#hoverZone.alpha = 1;
    });

    this.addEventListener("pointerout", () => {
      if (!this.isConfigurable) {
        return;
      }

      this.#hoverZone.alpha = 0;
    });

    this.addEventListener("click", (evt: PIXI.FederatedPointerEvent) => {
      if (!this.isConfigurable) {
        return;
      }

      this.emit(
        GRAPH_OPERATIONS.GRAPH_NODE_PORT_VALUE_EDIT,
        this.port,
        evt.clientX,
        evt.clientY
      );
    });
  }

  set port(port: InspectablePort | null) {
    this.#port = port;

    const portTitle = port?.title || "";
    if (portTitle !== this.#label.text) {
      this.#label.text = portTitle;
    }

    const valuePreview = this.#createTruncatedValue(port);
    if (valuePreview !== this.#valuePreview.text) {
      this.#valuePreview.text = valuePreview;
      this.#positionElements();
    }

    if (!port) {
      this.isConfigurable = false;
      return;
    }

    this.isConfigurable = isConfigurablePort(port);
  }

  get port() {
    return this.#port;
  }

  get dimensions() {
    return { width: this.#width, height: this.#height };
  }

  set isConfigurable(isConfigurable: boolean) {
    if (isConfigurable) {
      this.eventMode = "static";
      this.#hoverZone.cursor = "pointer";
    } else {
      this.eventMode = "none";
      this.#hoverZone.cursor = "default";
    }

    this.#isConfigurable = isConfigurable;
    this.#isDirty = true;
  }

  get isConfigurable() {
    return this.#isConfigurable;
  }

  set showNodePreviewValues(showNodePreviewValues: boolean) {
    if (showNodePreviewValues === this.#showNodePreviewValues) {
      return;
    }

    this.#showNodePreviewValues = showNodePreviewValues;
    this.#isDirty = true;
  }

  get text() {
    return this.#label.text ?? "";
  }

  get value() {
    return this.#valuePreview.text ?? "";
  }

  #draw() {
    this.#hoverZone.clear();

    if (!this.isConfigurable) {
      return;
    }

    this.#hoverZone.beginPath();
    this.#hoverZone.roundRect(
      -this.#paddingLeft,
      -this.#paddingLeft,
      this.#width + this.#paddingLeft + this.#paddingRight,
      this.#height + this.#paddingTop + this.#paddingBottom,
      this.#radius
    );
    this.#hoverZone.closePath();
    this.#hoverZone.fill({ color: hoverColor });

    this.#hoverZone.alpha = 0;
    this.#hoverZone.visible = true;
  }

  #positionElements() {
    this.#label.x = 0;
    this.#label.y = 0;
    this.#valuePreview.x = 0;
    this.#valuePreview.y = this.#label.height + this.#spacing;

    this.#width = Math.max(this.#label.width, this.#valuePreview.width);
    this.#height = this.#label.height;

    if (this.#valuePreview.text !== "" && this.#showNodePreviewValues) {
      this.#valuePreview.visible = true;
      this.#width = PREVIEW_WIDTH;
      this.#height += this.#spacing + this.#valuePreview.height;
    }
  }

  #createTruncatedValue(port: InspectablePort | null) {
    if (!port) {
      return "";
    }

    if (!this.#showNodePreviewValues) {
      return "";
    }

    let { value } = port;
    if (value === null || value === undefined) {
      if (port.status === PortStatus.Missing && isConfigurablePort(port)) {
        return "(not configured)";
      }
      return "";
    }

    let valStr = "";
    if (typeof value === "object") {
      if (isLLMContent(value)) {
        value = [value];
      }

      if (isLLMContentArray(value)) {
        const firstValue = value[0];
        if (firstValue) {
          const firstPart = firstValue.parts[0];
          if (isTextCapabilityPart(firstPart)) {
            valStr = firstPart.text;
          } else if (isInlineData(firstPart)) {
            valStr = firstPart.inlineData.mimeType;
          } else if (isStoredData(firstPart)) {
            valStr = firstPart.storedData.mimeType;
          } else {
            valStr = "LLM Content Part";
          }
        } else {
          valStr = "0 items";
        }
      } else if (Array.isArray(value)) {
        valStr = `${value.length} item${value.length === 1 ? "" : "s"}`;
      }
    } else {
      valStr = value.toString();
    }

    if (valStr.length > 60) {
      valStr = `${valStr.substring(0, 60)}...`;
    }

    return valStr;
  }
}