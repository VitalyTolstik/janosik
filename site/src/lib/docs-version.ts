import packageMetadata from "../../../package.json";

/**
 * The root product version, resolved by the bundler at build time. A static
 * import keeps the path relative to this source file even after bundling.
 * CI checks both release tags and the rendered badge against this value.
 */
export const docsVersion = packageMetadata.version;
