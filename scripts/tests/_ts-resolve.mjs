/**
 * Test-only ESM resolver hook: lets the test runner load the app's real TypeScript engines.
 *
 * Vite resolves `./progress` to `progress.ts` for us, so the app source uses extensionless imports
 * (required by the project's `bundler` module resolution). Node's ESM resolver does not, which is
 * why the engine tests could only reach modules with no runtime imports of their own. This hook
 * appends the `.ts` extension for relative specifiers before handing resolution back to Node, so
 * `npm test` exercises the real gated progress engine and the real next-step ladder instead of a
 * copy of their logic.
 *
 * Type-only imports are erased by Node's type stripping, so the loaded graph stays small.
 */
export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}
