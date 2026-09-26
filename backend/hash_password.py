"""Print the ADMIN_PASSWORD_HASH (and optionally ADMIN_JWT_SECRET) lines for backend/.env.

Usage:
    python hash_password.py            # prompts for the admin password twice
    python hash_password.py --secret   # also prints a random ADMIN_JWT_SECRET
"""

import argparse
import getpass
import secrets
import sys

from security import BCRYPT_MAX_BYTES, hash_password

MIN_PASSWORD_LENGTH = 10


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate admin credentials for backend/.env.")
    parser.add_argument("--secret", action="store_true", help="also print a random ADMIN_JWT_SECRET")
    args = parser.parse_args()

    password = getpass.getpass("Admin password: ")
    if getpass.getpass("Repeat password: ") != password:
        print("The passwords do not match.", file=sys.stderr)
        return 1
    if len(password) < MIN_PASSWORD_LENGTH:
        print(f"Use at least {MIN_PASSWORD_LENGTH} characters.", file=sys.stderr)
        return 1
    if len(password.encode("utf-8")) > BCRYPT_MAX_BYTES:
        print(f"Use at most {BCRYPT_MAX_BYTES} bytes (bcrypt ignores anything longer).", file=sys.stderr)
        return 1

    print("\nAdd these lines to backend/.env:\n")
    print(f"ADMIN_PASSWORD_HASH={hash_password(password)}")
    if args.secret:
        print(f"ADMIN_JWT_SECRET={secrets.token_urlsafe(48)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
