// Synthetic, deterministic PDF; no personal information.
export function pdf(pages = 1, text = true) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${pages} /Kids [${Array.from({length:pages},(_,i)=>`${3+i*2} 0 R`).join(' ')}] >>`];
  for(let i=0;i<pages;i++) { const stream = (Array.isArray(text) ? text[i] : text) ? 'BT /F1 12 Tf 20 100 Td (Synthetic fixture) Tj ET' : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 ${3+pages*2} 0 R >> >> /Contents ${4+i*2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`); }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let body='%PDF-1.7\n', offsets=[0]; for(const [i,o] of objects.entries()){offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${o}\nendobj\n`;}
  const start=Buffer.byteLength(body);body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(x=>`${String(x).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(body);
}
