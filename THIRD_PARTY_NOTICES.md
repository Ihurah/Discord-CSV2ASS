# Third-Party Components

## FFmpeg

Video export launches the separate FFmpeg executable supplied by `ffmpeg-static`.
The bundled executable's license and build information are shipped alongside it
as `node_modules/ffmpeg-static/ffmpeg.exe.LICENSE` and
`node_modules/ffmpeg-static/ffmpeg.exe.README` inside the application resources.

The Windows binary currently supplied by the installed dependency is FFmpeg
6.1.1-essentials_build-www.gyan.dev, licensed under GPL version 3.
The build information identifies its FFmpeg source revision as:
https://github.com/FFmpeg/FFmpeg/commit/e38092ef93

Build provider and source/build information: https://www.gyan.dev/ffmpeg/builds/
Package download information: `node_modules/ffmpeg-static/README.md`.
Consult the actual bundled license and build information when updating binaries.

## React / Fluent UI

The workspace uses React, React DOM, Fluent UI React v9 and Fluent System Icons.
Project references: https://react.dev/ and https://github.com/microsoft/fluentui
and https://github.com/microsoft/fluentui-system-icons .
Bundled legal comments ship as `assets/ui/fluent-shell.js.LEGAL.txt`.
Complete React and Fluent UI license texts are copied to `assets/ui/licenses/`
by the UI build script.

The local electron-fluent-ui starter was consulted for its FluentProvider,
TabList, theme and card layout patterns. It is not bundled as a second app:
https://github.com/oliverschwendener/electron-fluent-ui

## gemoji

The emoji shortcode dictionary is provided by `gemoji` (MIT license).
Copyright (c) 2014 Titus Wormer.
Its complete license ships as `node_modules/gemoji/license`.
Project: https://github.com/wooorm/gemoji

## Noto Color Emoji

The app bundles the unmodified Noto Color Emoji font from Google Fonts for
Unicode emoji preview and video export rasterization. It is licensed under
the SIL Open Font License, version 1.1. The complete license ships as
`assets/fonts/NotoColorEmoji-LICENSE.txt`; font copyright metadata is preserved
in `assets/fonts/NotoColorEmoji.ttf`. Source information is in
`assets/fonts/README.md`.

Project: https://github.com/googlefonts/noto-emoji

## HandBrake Reference

The local HandBrake checkout was consulted to understand SSA rendering through
libass, notably `libhb/rendersub.c`. HandBrake source and executables are not
included in the application package. No HandBrake code is copied into this app.
HandBrake project: https://github.com/HandBrake/HandBrake

## User Assets

Additional custom emoji images are supplied by the user/developer.
YouTube emote images are included as developer presets and preview samples.
Their source URLs and provenance are recorded in `assets/youtube/SOURCES.md`
and `assets/youtube/emoji-map.json`. They remain
third-party artwork and are not covered by the gemoji dictionary's MIT license.
No Discord custom emoji images are included with the application.
