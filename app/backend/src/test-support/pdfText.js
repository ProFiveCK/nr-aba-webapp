import {PDFDocument,PDFArray,decodePDFRawStream} from 'pdf-lib';

/** Read text written by our standard-font PDF generators, including copied pages. */
export async function generatedPdfText(bytes) {
 const pdf=await PDFDocument.load(bytes),pages=[];
 for(const page of pdf.getPages()){
  const contents=page.node.Contents(),streams=contents instanceof PDFArray?contents.asArray():[contents];
  const text=[];
  for(const ref of streams){
   const stream=pdf.context.lookup(ref);if(!stream)continue;
   const operators=Buffer.from(decodePDFRawStream(stream).decode()).toString('ascii');
   for(const match of operators.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g))text.push(Buffer.from(match[1],'hex').toString('latin1'));
  }
  pages.push(text.join('\n'));
 }
 return pages.join('\n');
}
