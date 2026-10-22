// Authored ramp profiles as pure data (no three.js), shared by collision,
// placement and the model scaler. Every profile is one straight incline followed
// by a horizontal lip, matching Kenney's ramp.glb (CC0); ramp-model.js scales the
// downloaded mesh to these numbers so the visible deck and the collider agree.
const SOURCE_RUN_RATIO = 0.6604167819023132 / 0.7300000190734863; // incline run / deck length, measured from the GLB
// Metres cut from each toe corner. Corners clipped at an angle slide off the chamfer instead of stopping dead.
export const TOE_CHAMFER = 1.2;

function profile({width, length, height}) {
  const slopeRun = length * SOURCE_RUN_RATIO;
  return Object.freeze({width, length, height, slopeRun, angle: Math.atan2(height, slopeRun), chamfer: TOE_CHAMFER});
}

export const RAMP_SHAPES = Object.freeze({
  kicker: profile({width: 6, length: 6, height: 1.2}),
  standard: profile({width: 6, length: 10, height: 3.4}),
  mega: profile({width: 6, length: 16, height: 5}),
});
export const RAMP_SHAPE = RAMP_SHAPES.standard;

// Body-local collider outline: x is lateral, y is minus progress up the deck,
// so the car-frame transform used by planck places the toe at the ramp origin.
export function rampColliderVertices(shape) {
  const hw = shape.width / 2, c = shape.chamfer, L = shape.length;
  const outline = [[-hw + c, 0], [hw - c, 0], [hw, c], [hw, L], [-hw, L], [-hw, c]];
  return outline.map(([lateral, progress]) => [lateral, -progress]).reverse();
}
