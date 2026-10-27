# Bundled YouTube Emote Images

The bundled images are YouTube emote artwork downloaded from YouTube's image
CDN. They are not newly generated illustrations and are not covered by the
gemoji dictionary's MIT license.

The original image URL and corresponding comment token for every active
preset are recorded in [emoji-map.json](emoji-map.json). Images are cached in
`images/` with filenames derived from the SHA-256 hash of their source URL.
The mapping is the source of truth; unused cached versions are not required.

The first two active presets are also included in the default preview text.
See [README.md](README.md) for cache preparation and preset configuration.
