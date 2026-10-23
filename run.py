
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PACKAGE_JSON = ROOT / "package.json"


def fail(message: str, exit_code: int = 1) -> None:
    print(f"\n[ERROR] {message}", file=sys.stderr)
    raise SystemExit(exit_code)


def find_executable(*names: str) -> str | None:
    for name in names:
        executable = shutil.which(name)
        if executable:
            return executable
    return None


def main() -> int:
    print("=" * 44)
    print("       MiaSquid IDE - Starting...")
    print("=" * 44)
    print()

    os.chdir(ROOT)

    node = find_executable("node")
    if node is None:
        fail(
            "Node.js was not found in PATH.\n"
            "Install Node.js and make sure it is available in PATH."
        )

    npm = find_executable("npm")
    if npm is None:
        fail(
            "npm was not found in PATH.\n"
            "Install npm or add its executable directory to PATH."
        )

    if not PACKAGE_JSON.is_file():
        fail(f"package.json was not found:\n{PACKAGE_JSON}")

    try:
        with PACKAGE_JSON.open("r", encoding="utf-8") as file:
            package = json.load(file)
    except json.JSONDecodeError as exc:
        fail(f"package.json contains invalid JSON:\n{exc}")
    except OSError as exc:
        fail(f"Cannot read package.json:\n{exc}")

    scripts = package.get("scripts", {})
    if not isinstance(scripts, dict):
        fail("The 'scripts' field in package.json must be an object.")

    start_script = scripts.get("start")
    if not isinstance(start_script, str) or not start_script.strip():
        fail("package.json does not define a valid 'scripts.start' command.")

    try:
        node_result = subprocess.run(
            [node, "--version"],
            cwd=ROOT,
            check=False,
        )
        if node_result.returncode != 0:
            fail("Node.js failed to start.")

        npm_result = subprocess.run(
            [npm, "--version"],
            cwd=ROOT,
            check=False,
        )
        if npm_result.returncode != 0:
            fail("npm failed to start.")

    except OSError as exc:
        fail(f"Unable to check Node.js or npm:\n{exc}")

    print(f"[INFO] Project: {ROOT}")
    print(f"[INFO] Node.js: {node}")
    print(f"[INFO] npm: {npm}")
    print("[INFO] Starting MiaSquid IDE...")
    print()

    try:
        process = subprocess.run(
            [npm, "run", "start"],
            cwd=ROOT,
            check=False,
        )
        if process.returncode != 0:
            print(
                f"\n[ERROR] MiaSquid IDE exited with code "
                f"{process.returncode}.",
                file=sys.stderr,
            )
        else:
            print("\n[INFO] MiaSquid IDE exited successfully.")

        return process.returncode

    except KeyboardInterrupt:
        print("\n[INFO] Startup interrupted by user.")
        return 130
    except OSError as exc:
        print(f"\n[ERROR] Failed to launch npm:\n{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
