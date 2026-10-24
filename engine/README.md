# Bundled download engine

`xunlei-pan-cli.<version>.<arch>` is the official Xunlei NAS client (`pan.xunlei.cli`). The
backend starts it as `-q run runner` with `ALLOW_CUSTOM_PLATFORM=true`, so it runs natively
on a plain Linux host; see `../docs/architecture.md`.

| File | Version | Arch |
|---|---|---|
| `xunlei-pan-cli.3.23.3.arm64` | 3.23.3 | linux/arm64 |

For another architecture, drop the matching binary here (e.g. `xunlei-pan-cli.3.23.3.amd64`)
or set 「设置 → 下载引擎 → 引擎程序路径」.
