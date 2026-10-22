// Shadow-map texel snapping for a moving directional light (Valient, "Stable Rendering of Cascaded Shadow Maps",
// GPU Pro 2; Microsoft "Cascaded Shadow Maps" sample). The shadow camera is centred on a target that follows the
// car. If the target moves by an arbitrary amount, every shadow edge is re-rasterised at a sub-texel offset and
// shimmers by up to one texel. Snapping the target to whole texels measured in light space keeps the texel grid
// fixed in the world, so shadow edges only move when the geometry does.

/**
 * Writes the snapped shadow target into `out` ({x,y,z}) and returns it.
 * (x, z): target on the ground before snapping. lightX/Y/Z: vector from the target towards the light.
 * texel: world size of one shadow-map texel (metres) = (camera.right - camera.left) / mapSize.
 */
export function snapShadowAnchor(out, x, z, lightX, lightY, lightZ, texel) {
  const len = Math.hypot(lightX, lightY, lightZ) || 1;
  // View forward points from the light towards the target.
  const fx = -lightX / len, fy = -lightY / len, fz = -lightZ / len;
  // Light-space right = normalize(forward x worldUp), up = right x forward.
  let rx = -fz, rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  // up = right x forward (right has no y component).
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  // Target is on the ground (y = 0); project it on the light-space right and up axes.
  const a = x * rx + z * rz;
  const b = x * ux + 0 * uy + z * uz;
  const snappedA = Math.round(a / texel) * texel, snappedB = Math.round(b / texel) * texel;
  const da = snappedA - a, db = snappedB - b;
  out.x = x + rx * da + ux * db;
  out.y = 0 + uy * db;
  out.z = z + rz * da + uz * db;
  return out;
}
