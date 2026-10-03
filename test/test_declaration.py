# /// script
# requires-python = ">=3.12"
# dependencies = ["Cython==3.2.4"]
# ///
"""Checks that a popped declaration follows edits above and inside it."""
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import declaration


class DeclarationTests(unittest.TestCase):
    def test_cython_method_follows_edits_and_rejects_invalid_source(self):
        with TemporaryDirectory() as directory:
            file = Path(directory) / 'example.pyx'
            target = {'chain': [
                {'kind': 'class', 'name': 'Example'},
                {'kind': 'function', 'name': 'run'},
            ], 'line': 2}
            file.write_text('cdef class Example:\n    cpdef int run(self):\n        return 1\n')
            sys.argv = ['declaration.py', str(file), json.dumps(target)]
            self.assertEqual(declaration.main()['source'], '    cpdef int run(self):\n        return 1')
            file.write_text('# heading\n\ncdef class Example:\n    cpdef int run(self):\n        return 2\n')
            result = declaration.main()
            self.assertEqual((result['line'], result['endLine']), (4, 5))
            file.write_text('cdef class Example:\n    cpdef int run(:\n')
            self.assertEqual(declaration.main()['status'], 'invalid')

    def test_method_follows_inserted_lines(self):
        with TemporaryDirectory() as directory:
            file = Path(directory) / 'example.py'
            target = {'chain': [
                {'kind': 'class', 'name': 'Example'},
                {'kind': 'function', 'name': 'run'},
            ], 'line': 2}
            file.write_text('class Example:\n    def run(self):\n        return 1\n')
            sys.argv = ['declaration.py', str(file), json.dumps(target)]
            first = declaration.main()
            self.assertEqual((first['line'], first['endLine']), (2, 3))
            file.write_text('# a new heading\n\nclass Example:\n    def run(self):\n        return 2\n')
            second = declaration.main()
            self.assertEqual((second['line'], second['endLine']), (4, 5))
            self.assertIn('return 2', second['source'])


if __name__ == '__main__':
    unittest.main()
