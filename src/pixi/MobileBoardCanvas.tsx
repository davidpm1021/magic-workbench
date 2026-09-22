import type { Application } from "pixi.js";

import { BoardCanvasSurface, type BoardCanvasProps } from "./BoardCanvas";
import { MOBILE_BATTLEFIELD_LAYOUT } from "./board/battlefieldLayoutPolicy";
import type { BoardScene } from "./board/BoardScene";
import { MobileBoardScene } from "./board/MobileBoardScene";
import type { GameCanvasCallbacks } from "./types";

export type MobileBoardCanvasProps = Omit<BoardCanvasProps, "layoutPolicy">;

function createMobileBoardScene(app: Application, callbacks: GameCanvasCallbacks): BoardScene {
  return new MobileBoardScene(app, callbacks);
}

export function MobileBoardCanvas(props: MobileBoardCanvasProps) {
  return (
    <BoardCanvasSurface
      {...props}
      layoutPolicy={MOBILE_BATTLEFIELD_LAYOUT}
      createScene={createMobileBoardScene}
    />
  );
}
