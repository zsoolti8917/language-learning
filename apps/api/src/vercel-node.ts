// The Vercel function entry as a Node request listener `(req, res)`, which is what the
// Build Output API's Node launcher calls. It wraps the web standard handler of ./vercel.
// scripts/vercel-build.mjs bundles this file into .vercel/output/functions/api.func.
import { getRequestListener } from '@hono/node-server';
import { fetch } from './vercel';

export default getRequestListener((request) => fetch(request));
