// Prepara el modelo fuente del mago: suelda vértices, reduce la malla y
// recomprime las texturas. El resultado se usa como entrada del rigging.
//
// Uso: node tools/optimize-wizard.mjs [origen] [destino]

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  flatten,
  prune,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions';

const source = process.argv[2] || 'assets-source/model.glb';
const target = process.argv[3] || 'tmp-rig/mago-optimizado.glb';
const ratio = Number(process.env.SIMPLIFY_RATIO || 0.055);

fs.mkdirSync(path.dirname(target), { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(source);
const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
if (scene) {
  doc.getRoot().setDefaultScene(scene);
  scene.listChildren().forEach((node) => node.setTranslation([0, 0, 0]));
}

await MeshoptSimplifier.ready;

await doc.transform(
  flatten(),
  weld({ tolerance: 0.0001 }),
  simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.0025 }),
  textureCompress({
    encoder: sharp,
    targetFormat: 'jpeg',
    resize: [1024, 1024],
    quality: 86,
  }),
  dedup(),
  prune()
);

await io.write(target, doc);

const root = doc.getRoot();
const mesh = root.listMeshes()[0];
const prim = mesh.listPrimitives()[0];
const tris = prim.getIndices().getCount() / 3;
const verts = prim.getAttribute('POSITION').getCount();
const textures = root.listTextures();

console.log(`✓ ${target}`);
console.log(`  ${verts.toLocaleString('es')} vértices · ${Math.round(tris).toLocaleString('es')} triángulos`);
for (const texture of textures) {
  const image = texture.getImage();
  const size = texture.getSize();
  console.log(`  textura ${size ? `${size[0]}x${size[1]}` : '?'} · ${(image.byteLength / 1024).toFixed(0)} kB`);
}
console.log(`  ${(fs.statSync(target).size / 1024 / 1024).toFixed(2)} MB`);
