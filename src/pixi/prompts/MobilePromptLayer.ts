import type { Application } from "pixi.js";

import { PromptLayer } from "./PromptLayer";
import type { PromptLayerCallbacks } from "./prompt.types";

export class MobilePromptLayer extends PromptLayer {
  constructor(app: Application, callbacks: PromptLayerCallbacks = {}) {
    super(app, true, callbacks);
  }
}
