import { getViteConfig } from 'astro/config';
import type { ViteUserConfig } from 'vitest/config';

// La config de Astro resuelve `astro:env/server` y `astro/zod`; los tests
// reemplazan `astro:env/server` con `test/env.ts` para poder variar las variables.
// El tipo de getViteConfig no conoce `test`: de ahí el cast.
const config: ViteUserConfig = { test: { include: ['src/**/*.test.ts'] } };
export default getViteConfig(config as Parameters<typeof getViteConfig>[0]);
