import { z } from 'zod';

const number = z.number().finite();
const vector = z.tuple([number, number, number]);
const dimension = number.min(.01).max(1000);
const size = z.tuple([dimension, dimension, dimension]);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
export const shapes = ['box','sphere','cylinder','cone','capsule','torus','prism','mesh'] as const;

const simplePart = z.object({
  name:z.string().min(1).max(100), position:vector, size,
  rotation:vector.optional(), color:color.optional(),
  roughness:number.min(0).max(1).optional(), metalness:number.min(0).max(1).optional(),
  emissive:color.optional(),
});
const point = z.tuple([number.min(-.5).max(.5),number.min(-.5).max(.5)]);
export const partSchema = z.discriminatedUnion('shape', [
  simplePart.extend({shape:z.enum(['box','sphere','cylinder','cone','capsule','torus'])}),
  simplePart.extend({shape:z.literal('prism'),profile:z.array(point).min(3).max(64)}),
  simplePart.extend({shape:z.literal('mesh'),vertices:z.array(vector).min(3).max(256),
    triangles:z.array(z.tuple([z.number().int().min(0).max(255),z.number().int().min(0).max(255),z.number().int().min(0).max(255)])).min(1).max(512)}),
]);
export const assemblySchema = z.object({size,parts:z.array(partSchema).min(1).max(160)});
export type Part = z.infer<typeof partSchema>;
export type Assembly = z.infer<typeof assemblySchema>;
export const reportSchema = z.object({
  exact:z.number().int().min(0), procedural:z.number().int().min(0), composed:z.number().int().min(0),
  proxies:z.number().int().min(0), tracks:z.number().int().min(0), shots:z.number().int().min(0),
  warnings:z.array(z.string().max(350)).max(300),
  assumptions:z.array(z.string().max(4000)).max(24).optional(),
});
export type SceneReport = z.infer<typeof reportSchema>;
