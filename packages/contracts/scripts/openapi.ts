// Prints the OpenAPI document of the contracts; `pnpm openapi` redirects it to docs/openapi.json.
// It writes to stdout instead of importing node:fs, because the dependency check forbids input
// and output modules anywhere in this package.
import { renderOpenApi } from '../src/openapi';

process.stdout.write(renderOpenApi());
