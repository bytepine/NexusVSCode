import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import build_vscode


class PackagingDocsTest(unittest.TestCase):
    def test_bilingual_docs_in_package_and_restore_after_success_or_failure(self):
        for fail in (False, True):
            with self.subTest(packaging_failure=fail), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                changelog = "# History\r\n\r\n## [Unreleased]\r\n\r\n" + "".join(
                    f"## [1.0.{version}]\r\n\r\n- Change {version}\r\n\r\n"
                    for version in range(7, 0, -1)
                )
                sources = {
                    "package.json": json.dumps({"version": "0.0.0"}) + "\r\n",
                    "CHANGELOG.md": changelog,
                    "CHANGELOG.en.md": changelog.replace("History", "English history"),
                    "README.md": "# 中文项目指南\r\n[English](README.en.md)\r\n",
                    "README.en.md": "[简体中文](README.md)\r\n# English project guide\r\n",
                    "README.marketplace.md": "# English listing\r\n[简体中文](README.marketplace.zh.md)\r\n",
                    "README.marketplace.zh.md": "# 中文商店介绍\r\n[English](README.marketplace.md)\r\n",
                }
                for name, content in sources.items():
                    (root / name).write_bytes(content.encode("utf-8"))

                def run(command, **kwargs):
                    if command[1:3] != ["vsce", "package"]:
                        return subprocess.CompletedProcess(command, 0)
                    self.assertEqual((root / "README.md").read_bytes(), (root / "README.marketplace.md").read_bytes())
                    english = (root / "README.en.md").read_text(encoding="utf-8")
                    self.assertIn("[简体中文](README.marketplace.zh.md)", english)
                    self.assertTrue((root / "README.marketplace.zh.md").is_file())
                    for name in ("CHANGELOG.md", "CHANGELOG.en.md"):
                        text = (root / name).read_text(encoding="utf-8")
                        self.assertEqual(re.findall(r"^## \[([^]]+)\]", text, re.MULTILINE), [f"1.0.{i}" for i in range(7, 2, -1)])
                    if fail:
                        raise subprocess.CalledProcessError(1, command)
                    (root / "package.vsix").write_bytes(b"packaged")
                    return subprocess.CompletedProcess(command, 0)

                with patch.object(build_vscode, "repo_root", return_value=str(root)), patch.object(build_vscode.subprocess, "run", side_effect=run):
                    if fail:
                        with self.assertRaises(subprocess.CalledProcessError):
                            build_vscode.build_vscode_extension("1.0.7", str(root / "output"))
                    else:
                        output = build_vscode.build_vscode_extension("1.0.7", str(root / "output"))
                        self.assertEqual(Path(output).read_bytes(), b"packaged")
                for name, content in sources.items():
                    self.assertEqual((root / name).read_bytes(), content.encode("utf-8"), name)


if __name__ == "__main__":
    unittest.main()
