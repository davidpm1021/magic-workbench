import type { Application } from "pixi.js";

import type { GameCanvasCallbacks } from "../types";
import { BoardScene } from "./BoardScene";

export class MobileBoardScene extends BoardScene {
  constructor(app: Application, callbacks: GameCanvasCallbacks) {
    super(app, callbacks, true);
  }
}
