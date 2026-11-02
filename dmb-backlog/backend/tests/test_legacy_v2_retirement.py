"""Executable retirement regression: no DB connections or protected fixtures."""
from __future__ import annotations
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
# Restrict import configuration to this context; importing this test must not
# change environment variables for other test modules.
with patch.dict(os.environ, {
    "DATABASE_URL": "sqlite:///:memory:",
    "RUN_STARTUP_SEED": "false",
    "RUN_STARTUP_MAINTENANCE": "false",
    "RUN_NOTIFICATION_SCHEDULER": "false",
    "ASSISTANT_V2_ENABLED": "true",
}):
    from config import Settings
    import main

class LegacyRetirementTests(unittest.TestCase):
    def test_old_environment_cannot_register_retired_api(self):
        paths = {getattr(route, "path", "") for route in main.app.routes}
        self.assertFalse(any(p.startswith("/api/v2/assistant") or p.startswith("/internal/assistant-v2/") for p in paths))
        self.assertTrue(any(p.startswith("/api/v1/meeting-capture") for p in paths))
        self.assertTrue(any(p.startswith("/api/v1/tasks") for p in paths))
        with patch.dict(os.environ, {"ASSISTANT_V2_ENABLED": "true"}):
            self.assertFalse(hasattr(Settings(), "ASSISTANT_V2_ENABLED"))

    def test_bootstrap_only_advertises_current_v2(self):
        with patch.object(main, "agent_v2_pilot_allowed", return_value=True), patch.object(main, "agent_v2_operator_role", return_value="BA"):
            features = main.feature_bootstrap(object())
        self.assertNotIn("assistant_v2", features)
        self.assertIn("agent_v2", features)
        self.assertEqual(features["agent_v2"]["operator_role"], "BA")

    def test_current_v2_gateway_is_still_available_when_enabled(self):
        from services import agent_v2_gateway
        self.assertTrue(callable(agent_v2_gateway.trusted_context))
        self.assertTrue(callable(agent_v2_gateway.proxy_request))

if __name__ == "__main__":
    unittest.main()
