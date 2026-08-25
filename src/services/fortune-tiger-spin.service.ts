/** @deprecated Import from procedural-spin.service.js */
export {
  extractPaylines,
  evaluateAllPaylines,
  generateFortuneTigerSpin,
  generateProceduralSpin,
  proceduralSpinToTemplate,
  type PaylineDef,
  type ProceduralSpinResult,
} from "./procedural-spin.service.js";

export type FortuneTigerSpinResult = import("./procedural-spin.service.js").ProceduralSpinResult;

export const FORTUNE_TIGER_PAYLINES = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
  [1, 5, 9],
  [7, 5, 3],
] as const;

export { evaluateAllPaylines as evaluateGrid, proceduralSpinToTemplate as fortuneTigerSpinToTemplate } from "./procedural-spin.service.js";
