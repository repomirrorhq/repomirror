const path = require('path');

// Mock process.cwd()
const mockCwd = '/tmp/test-dir';
process.cwd = () => mockCwd;

const sourceRepo = './source';

// Our current logic
const baseDir1 = sourceRepo && sourceRepo !== './' 
  ? path.resolve(process.cwd(), sourceRepo) 
  : process.cwd();

console.log('sourceRepo:', sourceRepo);
console.log('process.cwd():', process.cwd());
console.log('baseDir:', baseDir1);
console.log('Expected files at:', path.join(baseDir1, '.repomirror'));
