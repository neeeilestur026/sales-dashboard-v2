"""Environment the blueprints share — A299. One place, read once, so a value cannot be read
under two names in two files (INTERNAL_SHARED_SECRET was read in three)."""

import os

DASHBOARD_APPS_SCRIPT_URL = os.environ.get("DASHBOARD_APPS_SCRIPT_URL", "")
INTERNAL_SHARED_SECRET = os.environ.get("INTERNAL_SHARED_SECRET", "")
