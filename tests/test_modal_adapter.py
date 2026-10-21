import ast
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from fastapi.testclient import TestClient
import modal_runtime as runtime


class ModalAdapterTests(unittest.TestCase):
    def test_wake_requires_auth_and_ignores_customer_job_parameters(self):
        spawn = AsyncMock(return_value=types.SimpleNamespace(object_id="call-fixture"))
        client = TestClient(runtime.build_wake_app(spawn))
        with patch.dict("os.environ", {"MINT_WAKE_TOKEN": "a" * 64}):
            self.assertEqual(client.post("/wake").status_code, 401)
            self.assertEqual(client.post("/wake", headers={"Authorization": "Bearer wrong"}).status_code, 401)
            spawn.assert_not_called()
            response = client.post("/wake", headers={"Authorization": "Bearer " + "a" * 64}, json={"tier":"Prismatic","job":"untrusted"})
            self.assertEqual(response.status_code,202)
            spawn.assert_awaited_once_with()
        with patch.dict("os.environ", {"MINT_WAKE_TOKEN": ""}):
            self.assertEqual(client.post("/wake",headers={"Authorization":"Bearer "}).status_code,401)

    def test_probe_wakes_for_ready_or_stale_jobs(self):
        with patch.object(runtime,"rest_has_rows",return_value=True) as probe:
            self.assertTrue(runtime.needs_work())
            self.assertEqual(probe.call_args.args[0],"mints")
            self.assertIn("lease_until.lt",probe.call_args.args[1]["or"])

    def test_missing_webhooks_checked_every_five_minutes(self):
        with patch.object(runtime,"datetime") as clock, patch.object(runtime,"rest_has_rows",side_effect=[False,False,True]) as probe:
            clock.now.return_value=datetime(2026,10,19,12,5,tzinfo=timezone.utc)
            self.assertTrue(runtime.needs_work())
            self.assertEqual(probe.call_args.args[0],"orders")
        with patch.object(runtime,"datetime") as clock, patch.object(runtime,"rest_has_rows",return_value=False) as probe:
            clock.now.return_value=datetime(2026,10,19,12,6,tzinfo=timezone.utc)
            self.assertFalse(runtime.needs_work())
            self.assertEqual(probe.call_count,2)

    def test_runtime_uses_finite_batch_without_printing_secrets(self):
        with patch.object(runtime.subprocess,"run") as execute:
            self.assertEqual(runtime.run_batch(),{"batch":"finished"})
            self.assertEqual(execute.call_args.args[0][-1],"--batch")
            self.assertEqual(execute.call_args.kwargs["timeout"],580)
            self.assertEqual(execute.call_args.kwargs["env"]["MINT_BATCH_LIMIT"],"10")

    def test_sdk_definitions_load_without_auth_or_deployment(self):
        spec=importlib.util.spec_from_file_location("pixel_modal_test",ROOT/"modal_mint.py")
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.app.name,"pixel-shroom-mint")
        source=(ROOT/"modal_mint.py").read_text()
        ast.parse(source)
        self.assertIn('max_containers=1',source)
        self.assertIn('memory=4096',source)
        self.assertNotIn('add_local_dir',source)
        self.assertNotIn('private.pem',source)


if __name__=="__main__":
    unittest.main()
