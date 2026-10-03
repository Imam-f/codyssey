# /// script
# requires-python = ">=3.12"
# dependencies = ["Cython==3.2.4"]
# ///
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from canvas import snapshot


class CanvasTests(unittest.TestCase):
    def test_snapshots_decorated_and_nested_declarations(self):
        with TemporaryDirectory() as directory:
            file = Path(directory) / 'example.py'
            previous = 'class Example:\n    def run(self):\n        return 1\n'
            file.write_text('# heading\nclass Example:\n    @staticmethod\n    def run():\n        return 2\n', encoding='utf8')
            result = snapshot(file, previous)
            self.assertEqual(result['status'], 'found')
            self.assertEqual(result['declarations'][0]['line'], 2)
            method = result['declarations'][1]
            self.assertEqual((method['line'], method['endLine']), (3, 5))
            self.assertEqual(method['chain'], [{'kind': 'class', 'name': 'Example'}, {'kind': 'function', 'name': 'run'}])
            self.assertTrue(any(change[0] != 'equal' for change in result['changes']))

    def test_invalid_source_is_stale(self):
        with TemporaryDirectory() as directory:
            file = Path(directory) / 'broken.py'
            file.write_text('def broken(:\n', encoding='utf8')
            result = snapshot(file, 'def valid():\n    return 1\n')
            self.assertEqual(result['status'], 'stale')
            self.assertNotIn('source', result)


if __name__ == '__main__':
    unittest.main()
