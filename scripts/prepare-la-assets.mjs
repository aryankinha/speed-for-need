/** Prepare the downloaded, authored CC0 buildings; does not generate geometry.
 * Prerequisites: npm install --prefix /tmp/la-opt-tools @gltf-transform/core
 * @gltf-transform/functions @gltf-transform/extensions sharp meshoptimizer
 * Inputs: the official Quaternius Standard archive extracted under
 * /tmp/la-real-assets/downtown, and the official Poly Haven 1K glTF + dependencies
 * under /tmp/la-real-assets/urban. Override LA_ASSET_INPUT / LA_ASSET_TOOLS.
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const tools = process.env.LA_ASSET_TOOLS || '/tmp/la-opt-tools';
const require = createRequire(join(tools, 'package.json'));
const { NodeIO } = await import(pathToFileURL(require.resolve('@gltf-transform/core')));
const { dedup, prune, weld, simplify, compactPrimitive, getBounds, flatten, join: joinMeshes } = await import(pathToFileURL(require.resolve('@gltf-transform/functions')));
const { ALL_EXTENSIONS } = await import(pathToFileURL(require.resolve('@gltf-transform/extensions')));
const { MeshoptSimplifier } = await import(pathToFileURL(require.resolve('meshoptimizer')));
const sharp = require('sharp');
const input = process.env.LA_ASSET_INPUT || '/tmp/la-real-assets';
const output = resolve(fileURLToPath(new URL('../dist/assets/la-real/', import.meta.url)));
await mkdir(output, { recursive: true });
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const report = [];
async function prepare(source, name, selectedNames = null, mergeStatic = false) {
  const doc = await io.read(source);
  if (selectedNames) {
    for (const node of [...doc.getRoot().listNodes()]) {
      if (!selectedNames.includes(node.getName())) node.dispose();
      else node.setTranslation([0, 0, 0]); // Remove the author's display-grid offsets.
    }
    await doc.transform(prune());
    // Retain silhouettes, UV seams and hard edges while removing coplanar tessellation.
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: .2, error: .001, lockBorder: true }));
  }
  await doc.transform(dedup(), prune());
  if (mergeStatic) await doc.transform(flatten(), joinMeshes({ keepNamed: false }), prune());
  for (const texture of doc.getRoot().listTextures()) {
    const original = texture.getImage();
    if (!original) continue;
    const label = texture.getName().toLowerCase();
    const isData = /normal|nor_gl|orm|arm/.test(label);
    const limit = isData ? 512 : 1024;
    const pipeline = sharp(original).resize({ width: limit, height: limit, fit: 'inside', withoutEnlargement: true });
    const meta = await sharp(original).metadata();
    // Retain useful alpha, but discard a redundant all-255 channel on normal maps.
    const stats = meta.hasAlpha ? await sharp(original).stats() : null;
    const meaningfulAlpha = meta.hasAlpha && stats.channels.at(-1).min < 255;
    const image = meaningfulAlpha ? await pipeline.png().toBuffer() : await pipeline.removeAlpha().jpeg({ quality: isData ? 92 : 88, chromaSubsampling: '4:4:4' }).toBuffer();
    texture.setImage(image).setMimeType(meaningfulAlpha ? 'image/png' : 'image/jpeg').setURI('');
  }
  const binary = await io.writeBinary(doc);
  await writeFile(join(output, name + '.glb'), binary);
  const root = doc.getRoot();
  const triangles = root.listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() || p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  report.push({ file: name + '.glb', bytes: binary.length, sha256: sha256(binary), triangles, materials: root.listMaterials().map(m => m.getName()), bounds: root.listScenes().map(getBounds), nodes: root.listNodes().map(n => n.getName()), sourceFileSha256: sha256(await readFile(source)) });
}
const downtown = join(input, 'downtown/Exports/glTF (Godot)');
await prepare(join(downtown, 'Building_Small_1.gltf'), 'la-building-small');
await prepare(join(downtown, 'Building_Medium_2_001.gltf'), 'la-building-medium');
await prepare(join(downtown, 'Building_Large_2.gltf'), 'la-building-large');
await prepare(join(input, 'urban/modular_urban_apartments_facade_1k.gltf'), 'la-facade-kit', [
  'wall_window_centered_large_01', 'window_centered_large_01',
  'wall_door_centered_large_01', 'door_centered_large_01',
  'crown_standard_standard_01', 'wall_standard_standard_01',
]);
await prepare(join(input, 'lamp/street_lamp_01_1k.gltf'), 'la-street-lamp');
await prepare(join(input, 'palm-original.glb'), 'la-palm', null, true);
// Far silhouettes retain the same materials, images, origin and meter scale.
// Meshoptimizer weights normal/UV attributes; six extreme vertices per primitive
// are locked to preserve its exact physical bounds through the far-LOD switch.
for (const name of ['la-building-small', 'la-building-medium', 'la-building-large', 'la-street-lamp']) {
  const source = join(output, name + '.glb');
  const doc = await io.read(source);
  // Work from the original indexed primitives so extreme trim details survive.
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION');
    const indices = primitive.getIndices();
    const normal = primitive.getAttribute('NORMAL');
    const uv = primitive.getAttribute('TEXCOORD_0');
    const stride = (normal ? 3 : 0) + (uv ? 2 : 0);
    const attributes = new Float32Array(position.getCount() * stride);
    for (let i = 0; i < position.getCount(); i++) {
      let offset = i * stride;
      if (normal) { for (let c = 0; c < 3; c++) attributes[offset++] = normal.getArray()[i * 3 + c]; }
      if (uv) { for (let c = 0; c < 2; c++) attributes[offset++] = uv.getArray()[i * 2 + c]; }
    }
    const weights = [...(normal ? [.1, .1, .1] : []), ...(uv ? [.1, .1] : [])];
    const locks = new Uint8Array(position.getCount());
    for (let axis = 0; axis < 3; axis++) {
      let minIndex = indices.getArray()[0], maxIndex = minIndex;
      for (const i of indices.getArray()) {
        if (position.getArray()[i * 3 + axis] < position.getArray()[minIndex * 3 + axis]) minIndex = i;
        if (position.getArray()[i * 3 + axis] > position.getArray()[maxIndex * 3 + axis]) maxIndex = i;
      }
      locks[minIndex] = locks[maxIndex] = 1;
    }
    const ratio = name === 'la-street-lamp' ? .1 : .15;
    const [reduced] = MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(indices.getArray()), position.getArray(), 3, attributes, stride, weights, locks, Math.floor(indices.getCount() * ratio / 3) * 3, .015, ['Permissive']);
    // Tiny disconnected trim components can disappear despite vertex locks.
    // Retain their original extremal triangle rather than adding replacement geometry.
    const kept = new Set(reduced), restored = [...reduced], original = indices.getArray();
    for (let i = 0; i < locks.length; i++) if (locks[i] && !kept.has(i)) {
      const offset = original.indexOf(i);
      if (offset < 0) continue;
      const triangle = offset - offset % 3;
      for (let c = 0; c < 3; c++) { restored.push(original[triangle + c]); kept.add(original[triangle + c]); }
    }
    primitive.setIndices(indices.clone().setArray(new Uint32Array(restored)));
    compactPrimitive(primitive);
  }
  await doc.transform(prune());
  const binary = await io.writeBinary(doc);
  await writeFile(join(output, name + '-lod.glb'), binary);
  const root = doc.getRoot();
  const triangles = root.listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() || p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  report.push({ file: name + '-lod.glb', bytes: binary.length, sha256: sha256(binary), triangles, materials: root.listMaterials().map(m => m.getName()), bounds: root.listScenes().map(getBounds), nodes: root.listNodes().map(n => n.getName()), sourceFileSha256: sha256(await readFile(source)), simplification: { targetRatio: .15, error: .015, attributes: 'NORMAL .1 / TEXCOORD_0 .1', flags: ['Permissive'] } });
}
await writeFile(join(output, 'preparation-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
