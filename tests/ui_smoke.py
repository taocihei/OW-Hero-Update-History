"""Compatibility entry point for the current end-to-end UI smoke suite.

The original script targeted the pre-OWTV layout and contained stale counts and
selectors.  Keep the familiar command while delegating to the maintained
regression flow.
"""

from ui_usage_regression import main


if __name__ == "__main__":
    main()
