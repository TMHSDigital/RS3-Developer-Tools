// Re-exports from lua-types plus the identifier test used by the model builder.

export {
  collectReferences,
  convertReturns,
  convertType,
  dedupe,
  optionalType,
  parseParam,
  renderFunParams,
  renderFunType,
  splitTopLevel,
  wrapIfUnion,
} from "./lua-types.js";

/** True for "Name", "ui.Name", "audio.Sound.Instance" and similar dotted identifiers. */
export function looksLikeIdentifierPath(text: string): boolean {
  return /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(text.trim());
}
