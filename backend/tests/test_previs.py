from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from app.main import app
from app.previs import Project
import json

sample = {
    "version":3,"id":"test","title":"Car scene","script":"The car drives down the street.",
    "stage":{"bounds":[12,6,34],"objects":[{"id":"car","name":"Car","kind":"car","size":[2,1.5,4],"position":[0,0,-10]}]},
    "tracks":[{"objectId":"car","action":"drive","keys":[{"time":0,"position":[0,0,-10]},{"time":4,"position":[0,0,10]}]}],
    "cameras":[{"id":"c1","name":"Low view","position":[0,.15,0],"target":[0,.4,-5],"fov":55}],
    "shots":[{"id":"s1","name":"Pass","cameraId":"c1","start":0,"duration":4}],
    "fps":24,
}

class PrevisTests(IsolatedAsyncioTestCase):
    def test_validate_rejects_missing_camera(self):
        broken = {**sample, "shots":[{**sample["shots"][0], "cameraId":"missing"}]}
        self.assertEqual(TestClient(app).post("/api/previs/validate",json=broken).status_code,422)

    def test_validate_accepts_motion(self):
        reply = TestClient(app).post("/api/previs/validate",json=sample)
        self.assertEqual(reply.status_code,200)
        self.assertEqual(reply.json()["tracks"][0]["keys"][1]["position"],[0,0,10])
        self.assertNotIn("yaw",reply.json()["tracks"][0]["keys"][0])

    def test_generate_uses_v3_schema_and_repairs_invalid_result(self):
        with patch("app.main.invoke",new_callable=AsyncMock) as invoke:
            invoke.side_effect = ['{}',json.dumps(sample)]
            reply = TestClient(app).post("/api/previs/draft",json={"script":"A sedan passes over a low camera."})
        self.assertEqual(reply.status_code,200)
        self.assertEqual(reply.json()["script"],"A sedan passes over a low camera.")
        self.assertEqual(invoke.await_count,2)
        self.assertEqual(invoke.await_args.kwargs["schema"],Project.model_json_schema())

    def test_blocking_only_keeps_original_stage_and_camera(self):
        different = json.loads(json.dumps(sample))
        different["title"] = "Ignore this title"
        different["stage"]["objects"][0]["name"] = "Ignore this name"
        different["cameras"][0]["fov"] = 100
        different["tracks"][0]["keys"][1]["position"] = [0,0,14]
        with patch("app.main.invoke",new_callable=AsyncMock) as invoke:
            invoke.return_value = json.dumps(different)
            reply = TestClient(app).post("/api/previs/draft",json={
                "script":"Make the passing car go farther.",
                "scope":"blocking",
                "current":sample,
            })
        self.assertEqual(reply.status_code,200)
        self.assertEqual(reply.json()["title"],sample["title"])
        self.assertEqual(reply.json()["stage"]["objects"][0]["name"],"Car")
        self.assertEqual(reply.json()["cameras"][0]["fov"],55)
        self.assertEqual(reply.json()["tracks"][0]["keys"][1]["position"],[0,0,14])
