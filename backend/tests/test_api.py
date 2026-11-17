import unittest, json, tempfile, os
from pathlib import Path
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from app import main
from app.models import Scene, spatial_warnings

class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.data_patch=patch.object(main,'DATA',Path(self.temp.name));self.data_patch.start()
        self.client=TestClient(main.app)
        self.example=json.loads((main.BASE/'examples'/'1.json').read_text())
    def tearDown(self): self.data_patch.stop();self.temp.cleanup()
    def test_examples_are_valid_distinct_scenes(self):
        result=self.client.get('/api/examples').json()
        self.assertEqual(len(result),3)
        self.assertEqual(len({p['title'] for p in result}),3)
        for p in result:
            self.assertEqual(spatial_warnings(Scene.model_validate(p)),[])
    def test_duplicate_ids_rejected(self):
        self.example['objects'][1]['id']=self.example['objects'][0]['id']
        self.assertEqual(self.client.post('/api/validate',json=self.example).status_code,422)
    def test_new_scene_with_single_person_and_bed(self):
        p=self.example;p['objects']=[p['objects'][0],dict(p['objects'][2],kind='bed',shape='rectangular')]
        p['room']={'width':8,'depth':5,'height':3}
        self.assertEqual(self.client.post('/api/validate',json=p).status_code,200)
    def test_missing_credentials_explicit(self):
        with patch.dict(os.environ,{'LLM_API_KEY':'','LLM_MODEL':''}):
            r=self.client.post('/api/scene',json={'script':'A new person beside a counter.'})
            self.assertEqual(r.status_code,503)
    def test_outside_motion_warns(self):
        self.example['objects'][0]['motion']={'end_position':[40,0,0],'duration':3}
        r=self.client.post('/api/validate',json=self.example)
        self.assertTrue(r.json()['warnings'])
    def test_relation_reference_rejected(self):
        self.example['relations']=[{'subject':'missing','relation':'near','target':'ravi'}]
        self.assertEqual(self.client.post('/api/validate',json=self.example).status_code,422)
    def test_repair_keeps_raw_outputs(self):
        with patch.object(main,'invoke',new=AsyncMock(side_effect=['not json',json.dumps(self.example)])) as mock:
            r=self.client.post('/api/scene',json={'script':'A newly worded conversation in an office.'})
            self.assertEqual(r.status_code,200);self.assertEqual(mock.await_count,2)
        record=json.loads(next(Path(self.temp.name).glob('*.json')).read_text())
        self.assertEqual(record['attempts'][0]['raw'],'not json')
        self.assertEqual(record['scene']['description'],'A newly worded conversation in an office.')
    def test_no_infinite_retry(self):
        with patch.object(main,'invoke',new=AsyncMock(return_value='{}')) as mock:
            r=self.client.post('/api/scene',json={'script':'A person beside a table.'})
            self.assertEqual(r.status_code,422);self.assertEqual(mock.await_count,2)
    def test_invalid_input_never_calls_provider(self):
        with patch.object(main,'invoke',new=AsyncMock()) as mock:
            self.assertEqual(self.client.post('/api/scene',json={'script':'hi'}).status_code,422);mock.assert_not_called()
    def test_facing_relation(self):
        self.example['relations']=[{'subject':'asha','target':'ravi','relation':'faces'}]
        self.assertEqual(spatial_warnings(Scene.model_validate(self.example)),[])
        self.example['objects'][0]['rotation']=0
        self.assertIn('does not face',spatial_warnings(Scene.model_validate(self.example))[0])

if __name__=='__main__':unittest.main()
