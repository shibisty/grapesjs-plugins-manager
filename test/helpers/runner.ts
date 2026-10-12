import type { CodeRunner } from '../../src/runtime/loader';
import { PluginsManagerError } from '../../src/core/errors';

/**
 * Test code runner. Classic scripts: indirect eval (global scope, like a
 * <script>). ES modules: `export default X` / `export { a as default }`
 * rewritten into assignments — enough for test bundles.
 */
export const testRunner: CodeRunner = {
  async script(code) {
    try {
      (0, eval)(code);
    } catch (e) {
      throw new PluginsManagerError('script', 'Plugin script failed', e instanceof Error ? e.message : String(e));
    }
  },
  async module(code) {
    const ns: Record<string, unknown> = {};
    const body = code
      .replace(/export\s+default\s+/g, '__ns.default = ')
      .replace(/export\s*\{\s*(\w+)\s+as\s+default\s*\}\s*;?/g, '__ns.default = $1;')
      .replace(/export\s+(const|function)\s+(\w+)/g, (_m, kind: string, name: string) =>
        kind === 'function' ? `__ns.${name} = ${name}; function ${name}` : `const ${name} = __ns.${name}`
      );
    try {
      new Function('__ns', body)(ns);
    } catch (e) {
      throw new PluginsManagerError('script', 'Plugin module failed', e instanceof Error ? e.message : String(e));
    }
    return ns;
  },
};
