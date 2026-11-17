"""Regression checks for paid requests and incompatible provider modes."""
from unittest import TestCase
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.ai_media import SeedanceRequest, seedance_payload
from app.main import app

sample = {
    "mode":"omni","prompt":"A car passes the camera.","duration":4,"ratio":"9:16",
    "resolution":"720p","assets":[{"kind":"video_url","role":"reference_video","url":"https://example.com/test.mp4"}],
    "confirm_charge":True,
}

class MediaProviderTests(TestCase):
    def test_uses_official_omni_wire_structure(self):
        payload=seedance_payload(SeedanceRequest.model_validate(sample))
        self.assertEqual(payload["content"][1],{"type":"video_url","role":"reference_video",
                                               "video_url":{"url":"https://example.com/test.mp4"}})
        self.assertEqual(payload["duration"],4)

    def test_rejects_other_reference_types_in_frame_mode(self):
        req={**sample,"mode":"frames","ratio":"adaptive"}
        self.assertEqual(TestClient(app).post("/api/previs/seedance",json=req).status_code,422)

    def test_paid_action_requires_confirmation(self):
        req={**sample,"confirm_charge":False}
        self.assertEqual(TestClient(app).post("/api/previs/seedance",json=req).status_code,422)

    def test_valid_request_without_credentials_is_explicit(self):
        with patch.dict("os.environ",{"ARK_API_KEY":""}):
            self.assertEqual(TestClient(app).post("/api/previs/seedance",json=sample).status_code,503)
