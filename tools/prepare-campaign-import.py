"""Convert exported campaign briefs into a local Cloudflare D1 SQL import."""

import argparse
import csv
import re
from datetime import datetime, timezone
from pathlib import Path

FIELDS = (
    "checkout_session_id", "offer", "buyer_email", "business", "industry", "vibe",
    "colors", "goal", "landing_session_id", "landing_paid_at", "email_delivered_at", "created_at",
)
OPTIONAL = {"landing_session_id", "landing_paid_at", "email_delivered_at"}
TIMESTAMPS = {"landing_paid_at", "email_delivered_at", "created_at"}
SESSION = re.compile(r"cs_(test|live)_[A-Za-z0-9]{12,200}")


def parse_value(field, value):
    if not value and field in OPTIONAL:
        return "NULL"
    if value is None or (not value and field != "colors"):
        raise ValueError(f"Missing {field}")
    if field in {"checkout_session_id", "landing_session_id"} and not SESSION.fullmatch(value):
        raise ValueError(f"Invalid {field}")
    if field == "offer" and value not in {"attention", "monthly"}:
        raise ValueError("Unknown campaign offer")
    if field in TIMESTAMPS:
        stamp = datetime.fromisoformat(value)
        if stamp.tzinfo is None:
            raise ValueError(f"Missing time zone in {field}")
        stamp = stamp.astimezone(timezone.utc)
        value = stamp.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return f"CAST(X'{value.encode('utf-8').hex()}' AS TEXT)"


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("input_csv", type=Path)
    cli.add_argument("output_sql", type=Path)
    args = cli.parse_args()

    statements = []
    with args.input_csv.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        required = set(FIELDS) - OPTIONAL
        if not required.issubset(reader.fieldnames or ()):
            cli.error("CSV is missing required campaign_briefs columns.")
        for row in reader:
            try:
                values = ", ".join(parse_value(field, row.get(field)) for field in FIELDS)
            except ValueError as exc:
                cli.error(f"CSV row {reader.line_num}: {exc}")
            statements.append(
                f"INSERT INTO campaign_briefs ({', '.join(FIELDS)}) VALUES ({values}) "
                "ON CONFLICT (checkout_session_id) DO NOTHING;"
            )
    try:
        with args.output_sql.open("x", encoding="utf-8") as output:
            output.write("\n".join(statements) + "\n")
    except FileExistsError:
        cli.error("Choose a new output file to avoid replacing an existing import.")
    print(f"Prepared {len(statements)} campaign brief rows.")


if __name__ == "__main__":
    main()
