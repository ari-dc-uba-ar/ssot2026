const fs = require('fs');
const path = require('path');

const srcIndex = path.join(__dirname, 'index.html');
const destIndex = path.join(__dirname, 'dist', 'index.html');

if (!fs.existsSync(path.join(__dirname, 'dist'))) {
  fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
}

fs.copyFileSync(srcIndex, destIndex);
console.log('Copied index.html to dist/index.html');