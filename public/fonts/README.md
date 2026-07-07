# Fonts

Drop the **Zircon** font files here (they are referenced by `@font-face` in `src/index.css`):

```
Zircon-Regular.woff2   (weight 400)
Zircon-Medium.woff2    (weight 500)
Zircon-SemiBold.woff2  (weight 600)
Zircon-Bold.woff2      (weight 700)
Zircon-ExtraBold.woff2 (weight 800)
```

`.woff` versions are optional (for older browsers). If you only have `.ttf`/`.otf`,
convert them to `.woff2` (e.g. https://transfonter.org) — or update the `src:` URLs
in `src/index.css` to point at whatever extensions you have.

Until these files are present, the app falls back to Inter automatically.
