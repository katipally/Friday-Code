# friday-code-{{TARGET}}

Prebuilt friday binary for **{{TARGET}}**. This package is one of 8 platform-specific packages that ship under the [friday](https://github.com/katipally/friday-code) project.

## What this is

A standalone executable compiled with the Bun runtime and the OpenTUI native renderer embedded. Zero runtime dependencies, no Node, no system OpenGL, no Bun toolchain needed at runtime. About 25-45 MB.

## You probably don't want this package

This package is an **optional dependency** of the main [`friday-code`](https://www.npmjs.com/package/friday-code) package. You install that one. The launcher detects your platform and architecture at install time and pulls in the matching prebuilt binary as an optional dependency. If you're on **{{TARGET}}**, this is the one that gets selected.

```bash
# install the launcher (and the right binary for your platform automatically)
npm i -g friday-code
```

You only need this package directly if you want to pin a specific platform's binary, build a custom installer on top of it, or audit the binary independently. For everything else, use [`friday-code`](https://www.npmjs.com/package/friday-code).

## Verify

```bash
# the launcher downloads the binary, then:
friday --version
```

## Project

- Main package: [friday-code on npm](https://www.npmjs.com/package/friday-code)
- Source: [github.com/katipally/friday-code](https://github.com/katipally/friday-code)
- Releases (with SHASUMS256.txt): [github.com/katipally/friday-code/releases](https://github.com/katipally/friday-code/releases)
- README: [github.com/katipally/friday-code#readme](https://github.com/katipally/friday-code#readme)
- Issues: [github.com/katipally/friday-code/issues](https://github.com/katipally/friday-code/issues)

## License

MIT. See [LICENSE](https://github.com/katipally/friday-code/blob/main/LICENSE).
