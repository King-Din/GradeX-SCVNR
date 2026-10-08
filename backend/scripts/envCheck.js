require('dotenv').config();
const fs = require('fs');

const src = fs.readFileSync('src/services/drive.service.js', 'utf8');
const names = [...new Set([...src.matchAll(/process\.env\.(\w+)/g)].map((m) => m[1]))];

names.forEach((n) => {
    const v = process.env[n];
    if (v === undefined) {
        console.log(n, '| UNDEFINED');
        return;
    }
    const clean = v === v.trim() && !/['"]/.test(v);
    console.log(
        n,
        '| length', v.length,
        '| clean', clean,
        '| looksLikeId', v.includes('.apps.googleusercontent.com'),
        '| looksLikeSecret', v.startsWith('GOCSPX'),
        '| starts', JSON.stringify(v.slice(0, 3))
    );
});