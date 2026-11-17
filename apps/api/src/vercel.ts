// The Vercel entry: a web standard `fetch` handler as the default export. The runtime is
// built once per function instance, on the first request. F8 points vercel.json at it.
import { createRuntime, type Runtime } from './runtime';

let runtime: Promise<Runtime> | undefined;

function getRuntime(): Promise<Runtime> {
  runtime ??= createRuntime(process.env).catch((e: unknown) => {
    runtime = undefined;
    throw e;
  });
  return runtime;
}

export async function fetch(request: Request): Promise<Response> {
  const r = await getRuntime();
  return r.app.fetch(request);
}

export default { fetch };
