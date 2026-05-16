const fs = require('fs');
const content = fs.readFileSync('tesla.html', 'utf8');

let oB = 0, cB = 0, oP = 0, cP = 0;
let inStr = null, inEscape = false, inComment = null;

for (let i = 0; i < content.length; i++) {
    let c = content[i];
    let next = content[i+1];

    if (inEscape) { inEscape = false; continue; }
    if (c === '\\') { inEscape = true; continue; }

    if (inComment === '//') {
        if (c === '\n') inComment = null;
        continue;
    }
    if (inComment === '/*') {
        if (c === '*' && next === '/') { inComment = null; i++; }
        continue;
    }

    if (inStr) {
        if (c === inStr) inStr = null;
        continue;
    }

    if (c === '/' && next === '/') { inComment = '//'; i++; continue; }
    if (c === '/' && next === '*') { inComment = '/*'; i++; continue; }

    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }

    if (c === '{') oB++; 
    if (c === '}') cB++;
    if (c === '(') oP++; 
    if (c === ')') cP++;
}

console.log(`Braces: ${oB} / ${cB} (Delta: ${oB - cB})`);
console.log(`Parens: ${oP} / ${cP} (Delta: ${oP - cP})`);
