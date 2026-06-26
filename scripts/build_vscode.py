"""
build_vscode.py — NexusVSCode 扩展打包（独立仓）

用法:
    python scripts/build_vscode.py --version <版本号> [--output <输出目录>]

说明:
    1. 临时注入 package.json version
    2. 临时裁剪 CHANGELOG.md 为最近 5 个已发布版本（与 nexus-rider 插件页 change-notes 规则一致）
    3. npm ci → npm run build → vsce package
    4. 输出 nexus-mcp-vscode-<version>.vsix
    5. 恢复 package.json version 为 0.0.0、还原完整 CHANGELOG.md
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import shutil
import subprocess
import sys

# 与 nexus-rider build_rider.py 对齐：插件页只展示最近 N 个已发布版本
_CHANGELOG_MAX_VERSIONS = 5
_CHANGELOG_HEADING_RE = re.compile(r"^##\s+\[([^\]]+)\]")

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr.encoding and sys.stderr.encoding.lower() != "utf-8":
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_file(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def write_file(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def patch_package_json(pkg_path: str, version: str) -> str:
    original = read_file(pkg_path)
    patched = re.sub(
        r'("version"\s*:\s*")[^"]*(")',
        rf'\g<1>{version}\g<2>',
        original,
        count=1,
    )
    write_file(pkg_path, patched)
    return original


def trim_changelog(changelog_text: str, max_versions: int = _CHANGELOG_MAX_VERSIONS) -> str:
    """保留文件前言 + 最近 max_versions 个已发布版本段落（跳过 [Unreleased]）。

    与 nexus-rider build_rider.py 的 change-notes 提取规则一致，使插件页 Changelog
    只展示最近若干版本，而非完整历史。
    """
    lines = changelog_text.splitlines(keepends=True)
    headings = [
        (i, m.group(1).strip())
        for i, line in enumerate(lines)
        if (m := _CHANGELOG_HEADING_RE.match(line))
    ]
    if not headings:
        return changelog_text

    preamble = "".join(lines[: headings[0][0]])
    kept = []
    count = 0
    for k, (idx, ver) in enumerate(headings):
        if "Unreleased" in ver:
            continue
        end = headings[k + 1][0] if k + 1 < len(headings) else len(lines)
        kept.append("".join(lines[idx:end]))
        count += 1
        if count >= max_versions:
            break

    if not kept:
        return changelog_text
    return preamble + "".join(kept).rstrip() + "\n"


def patch_changelog(changelog_path: str) -> str | None:
    if not os.path.isfile(changelog_path):
        return None
    original = read_file(changelog_path)
    write_file(changelog_path, trim_changelog(original))
    return original


def build_vscode_extension(version: str, output_dir: str) -> str:
    root = repo_root()
    pkg_path = os.path.join(root, "package.json")
    changelog_path = os.path.join(root, "CHANGELOG.md")
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    npx_cmd = "npx.cmd" if sys.platform == "win32" else "npx"

    original_pkg = patch_package_json(pkg_path, version)
    original_changelog = patch_changelog(changelog_path)

    try:
        print("[build] npm ci ...")
        subprocess.run([npm_cmd, "ci", "--ignore-scripts"], cwd=root, check=True)

        print("[build] npm run build ...")
        subprocess.run([npm_cmd, "run", "build"], cwd=root, check=True)

        print(f"[build] vsce package (v{version}) ...")
        subprocess.run(
            [npx_cmd, "vsce", "package", "--no-dependencies", "--allow-missing-repository"],
            cwd=root,
            check=True,
        )

        vsix_files = glob.glob(os.path.join(root, "*.vsix"))
        if not vsix_files:
            raise FileNotFoundError(f"未找到 .vsix 产物: {root}")

        os.makedirs(output_dir, exist_ok=True)
        dst_path = os.path.join(output_dir, f"nexus-mcp-vscode-{version}.vsix")
        shutil.copy2(vsix_files[0], dst_path)
        os.remove(vsix_files[0])
        return dst_path
    finally:
        write_file(pkg_path, original_pkg)
        if original_changelog is not None:
            write_file(changelog_path, original_changelog)


def main() -> int:
    parser = argparse.ArgumentParser(description="打包 NexusVSCode 扩展")
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", default=None, help="默认 <repo>/release/")
    args = parser.parse_args()

    root = repo_root()
    output_dir = args.output or os.path.join(root, "release")

    try:
        path = build_vscode_extension(args.version, output_dir)
    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return 1
    print(f"[OK] {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
