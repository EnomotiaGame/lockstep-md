// Types for the Vite plugin's virtual modules. Reference them from your app:
//   /// <reference types="lockstep-md/virtual" />
declare module 'virtual:docs/structure' {
  const structure: import('./parse.js').StructureSection[]
  export default structure
}
declare module 'virtual:docs/locales' {
  const locales: { original: string; locales: string[] }
  export default locales
}
declare module 'virtual:docs/loaders' {
  const loaders: Record<string, () => Promise<{ default: Record<string, unknown> }>>
  export default loaders
}
